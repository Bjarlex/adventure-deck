const missions = [
  "Reverse Tourist Snap: Take a landmark photo in the least touristy way.",
  "Bridge Oracle: Ask a question on a bridge; the first sound is the answer.",
  "Urban Hide & Seek: One hides, the other searches with 3 clues.",
  "Copenhagen Riddle Drop: Make a riddle about a nearby landmark.",
  "Sound Bingo: Complete a row of urban sounds while walking.",
  "Secret Menu Challenge: Invent a secret menu item at a bar/café.",
  "Wind Compass: Walk in the direction of the wind for 20 minutes.",
  "Public Bench Debate: Argue a funny topic in a silly accent for 5 min.",
  "Pizza Triathlon: Eat a slice at 3 pizza places and rate vibe & crust.",
  "Guerilla Art: Leave a small temporary art installation in public.",
  "Soundtrack Walk: Walk like you're in a movie scene for 5 minutes.",
  "Stranger Story Swap: Ask a stranger a question & invent their backstory.",
  "Random S-Train Adventure: Pick a random stop & explore for 1 hour.",
  "Copenhagen Conspiracy Club: Invent a secret theory connecting two landmarks.",
  "Micro Treasure Hunt: Hide a small item; other must find it in 15 min.",
	"urban Tarot: draw “cards” from random harbour objects (boat = travel, crane = change).",
	"Public bench speed debates: 5-minute arguments on nonsense topics (“Is falafel better than smørrebrød?”).",
	"Soundtrack Roulette: one person plays a random Spotify song; you must walk as if you’re in that song’s movie scene."
];

let deck = [...missions];
let completed = [];

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

document.getElementById('draw').addEventListener('click', () => {
  if (deck.length === 0) {
    alert("Deck is empty! Shuffle to restart.");
    return;
  }
  const card = deck.pop();
  document.getElementById('mission').innerText = card;
});

document.getElementById('complete').addEventListener('click', () => {
  const current = document.getElementById('mission').innerText;
  if (!current || current === "Press “Draw a Card” to start!") return;
  completed.push(current);
  const li = document.createElement('li');
  li.innerText = current;
  document.getElementById('completed-list').appendChild(li);
  document.getElementById('mission').innerText = "Press “Draw a Card” to continue!";
});

document.getElementById('shuffle').addEventListener('click', () => {
  deck = [...missions.filter(m => !completed.includes(m))];
  shuffle(deck);
  alert("Deck shuffled! Remaining missions: " + deck.length);
});