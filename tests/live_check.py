# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""End-to-end check of the deployed Worker: plays a tiny live game with two simulated phones.

    uv run tests/live_check.py

Asks for the crew key (hidden as you type), sends it only to your Worker, never prints or stores it.
Creates one test game, then deletes it. Crew records are only read, never changed.
"""
import getpass
import json
import sys
import urllib.error
import urllib.request

WORKER = "https://adventure-deck.bjarkeapihl.workers.dev"
ORIGIN = "https://bjarlex.github.io"


def call(method, path, key, body=None):
    req = urllib.request.Request(
        WORKER + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"content-type": "application/json", "x-crew-key": key, "origin": ORIGIN, "user-agent": "adventure-deck-check/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode(errors="replace")[:200]


results = []


def check(name, cond, detail=""):
    results.append(cond)
    print(f"  {'OK  ' if cond else 'FAIL'} {name}" + (f"  ({detail})" if detail and not cond else ""))


def main():
    key = getpass.getpass("Crew key (hidden): ").strip()
    if not key:
        sys.exit("No key entered.")

    print("\nServer")
    s, b = call("GET", "/api/health", key)
    check("health says live games are available", s == 200 and b.get("live") is True, f"{s} {b}")
    s, b = call("POST", "/api/sync", key, {})
    check("crew key accepted", s == 200, f"{s} {b}")
    if s == 200:
        counts = {k: len(v) for k, v in b.items()}
        print(f"       crew records on the server: {counts}")
    else:
        sys.exit("\nStopping: the key was not accepted.")

    print("\nLive game (two simulated phones)")
    state = {"test": True, "id": "g_livecheck", "log": [], "turn": 0, "current": None}
    s, b = call("POST", "/api/live", key, {"state": state})
    check("phone A starts a live game", s == 201 and len(b.get("code", "")) == 4, f"{s} {b}")
    if s != 201:
        sys.exit("\nStopping: could not create a live game.")
    code, v = b["code"], b["version"]
    print(f"       join code: {code}")
    try:
        s, b = call("GET", f"/api/live/{code}", key)
        check("phone B joins with the code", s == 200 and b["state"]["id"] == "g_livecheck", f"{s} {b}")
        s, _ = call("GET", f"/api/live/{code}?since={v}", key)
        check("unchanged poll is cheap (204)", s == 204, f"{s}")

        a_state = {**state, "current": {"cardId": "g094"}}
        s, b = call("PUT", f"/api/live/{code}", key, {"baseVersion": v, "state": a_state})
        check("phone A draws a card", s == 200 and b["version"] == v + 1, f"{s} {b}")

        b_state = {**state, "current": {"cardId": "g017"}}
        s, b = call("PUT", f"/api/live/{code}", key, {"baseVersion": v, "state": b_state})
        check("phone B's simultaneous draw is refused (409)", s == 409, f"{s} {b}")
        check("…and phone B gets phone A's card back", isinstance(b, dict) and b.get("state", {}).get("current", {}).get("cardId") == "g094", f"{b}")

        s, b = call("GET", f"/api/live/{code}?since={v}", key)
        check("phone B's poll sees the new version", s == 200 and b["version"] == v + 1, f"{s} {b}")

        ended = {**a_state, "ended": {"record": {"id": "g_livecheck"}}}
        s, b = call("PUT", f"/api/live/{code}", key, {"baseVersion": v + 1, "state": ended})
        check("phone A ends the game", s == 200, f"{s} {b}")
    finally:
        s, _ = call("DELETE", f"/api/live/{code}", key)
        check("test game deleted", s == 200, f"{s}")
        s, _ = call("GET", f"/api/live/{code}", key)
        check("…and gone (404)", s == 404, f"{s}")

    print(f"\n{sum(results)}/{len(results)} checks passed" + ("" if all(results) else ": copy this output to Claude"))


if __name__ == "__main__":
    main()
