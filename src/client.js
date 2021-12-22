import io from 'socket.io-client';
import ai from './bot';
import config from './config';

let forceStartFlag = false;
let game = {};

const COLOR_MAP = [
	'RED',
	'LIGHT_BLUE',
	'GREEN',
	'CYAN',
	'ORANGE',
	'PINK',
	'MAGENTA',
	'MAROON',
	'GOLD',
	'BROWN',
	'BLUE',
	'LAVENDER',
];

export function ForceStart () {
	setTimeout(()=> {
		forceStartFlag = !forceStartFlag;
		document.getElementById("log").append("\nToggled force_start: " + forceStartFlag);
		socket.emit('set_force_start', config.GAME_ID, forceStartFlag);
	}, 100); // Keep from firing join and force_start events simultaneously
}

export function Join (userID, username) {
	document.getElementById("log").innerHTML = "Connected to lobby: " + config.GAME_ID;
	console.log('Joined custom game at http://bot.generals.io/games/' + encodeURIComponent(config.GAME_ID));
	socket.emit('join_private', config.GAME_ID, userID);

	// When you're ready, you can have your bot join other game modes.
	// Here are some examples of how you'd do that:

	// Join the 1v1 queue.
	// socket.emit('join_1v1', user_id);

	// Join the FFA queue.
	// socket.emit('play', user_id);

	// Join a 2v2 team.
	// socket.emit('join_team', 'team_name', user_id);
}

export function Quit () {
	document.getElementById("log").append("\nReplay:\n" + game.replay_url);
	console.log("Game over. Halting execution until next game begin.");
	game.gameOver = true;
	forceStartFlag = false;
	socket.emit('leave_game'); // Leave active game
	// socket.emit('cancel'); // Leave queue
}

export function Team (gameId, team) {
	socket.emit('set_custom_team', gameId, team)
}

var socket = io("wss://botws.generals.io");

// This happens on socket timeout, or after leaving the window open while letting the computer go to sleep.
socket.on('disconnect', function() {
	document.getElementById("log").append("\nGame disconnected.");
});

socket.on('connect', function() {
	// Setting the bot name only needs to be done once, ever. See API for more details.
	// socket.emit('set_username', config.BOT_USER_ID, config.BOT_NAME);
	// socket.emit('play', config.BOT_USER_ID); // Join the FFA queue
});

socket.on('game_lost', () => {
	document.getElementById("log").append("\nGame lost...disconnecting.\nClick Join Game to rejoin for a rematch.");
	socket.emit('chat_message', game.chatRoom, 'COMBAT LOG SAVED TO IMPROVE FUTURE ITERATIONS OF THIS BOT.');
	Quit();
});

socket.on('game_won', () => {
	document.getElementById("log").append("\nGame won!");
	socket.emit('chat_message', game.chatRoom, 'ALL HOSTILES ELIMINATED. AWAITING FURTHER INSTRUCTIONS. POWERING DOWN.');
	Quit();
});

socket.on("game_start", function(rawData) {
  document.getElementById("log").innerHTML = "Game starting...";
	// Initialize/Re-initialize game state used by both bot and client.
	game = {
		socket,
		chatRoom: null,
		map: [],
		generals: [], // The indices of generals we know of.
		cities: [], // The indices of cities we have vision of.
		armies: [],
		terrain: [],
		mapWidth: null,
		mapHeight: null,
		mapSize: null,
		myGeneralLocationIndex: null,
		myScore: {},
		playerIndex: null,
		opponents: [],
		team: null,
		turn: 0,
		gameOver: false,
		replay_url: null,
		usernames: [], // Ordered by playerIndex
	};

	game.playerIndex = rawData.playerIndex;

  game.replay_url =
    "http://bot.generals.io/replays/" + encodeURIComponent(rawData.replay_id);
  console.log("Game starting! The replay will be available after the game at " + game.replay_url);
	game.team = rawData.teams[rawData.playerIndex];
	game.usernames = rawData.usernames;
	game.chatRoom = rawData.chat_room;
	socket.emit('chat_message', game.chatRoom, 'GLHF!');
});

/* Returns a new array created by patching the diff into the old array.
 * The diff formatted with alternating matching and mismatching segments:
 * <Number of matching elements>
 * <Number of mismatching elements>
 * <The mismatching elements>
 * ... repeated until the end of diff.
 * Example 1: patching a diff of [1, 1, 3] onto [0, 0] yields [0, 3].
 * Example 2: patching a diff of [0, 1, 2, 1] onto [0, 0] yields [2, 0].
 */
function patch (old, diff) {
  var out = [];
  var i = 0;
  while (i < diff.length) {
    if (diff[i]) {
      // matching
      Array.prototype.push.apply(
        out,
        old.slice(out.length, out.length + diff[i])
      );
    }
    i++;
    if (i < diff.length && diff[i]) {
      // mismatching
      Array.prototype.push.apply(out, diff.slice(i + 1, i + 1 + diff[i]));
      i += diff[i];
    }
    i++;
  }
  return out;
}

socket.on("game_update", function(rawData) {
  // Patch the city and map diffs into our local variables.
  game.map = patch(game.map, rawData.map_diff);
  game.cities = patch(game.cities, rawData.cities_diff); // TODO: keep a history of known city locations
	game.myGeneralLocationIndex = rawData.generals[game.playerIndex];
	game.generals[game.playerIndex] = -1; // Remove our own general from the list, to avoid confusion.

	// Keep track of general locations, if discovered, even if no longer visible.
	for (let idx = 0; idx < rawData.generals.length; idx++) {
		const generalLocation = rawData.generals[idx];

		if (!game.generals || game.generals[idx] !== -1) { // We may need to track whether the player is still alive, as well
			game.generals[idx] = generalLocation;
		}
	}

	/**
	 * Extract scoreboard and general state into actionable data, because scores is not sorted according to playerIndex.
	 * playerIndex follows lobby order (playerIndex = 0 is the red player--generally lobby leader)?
	 * generals with a location of -1 are unknown.
	 * scores data format: [{total, tiles, i, color, dead}]
	 * Populates game.opponents array with scoreboard details for living opponents and null for dead players.
	 */
	rawData.scores.map((score) => {
		// TODO: Take teammates from rawData.teams into account & keep separate from opponents
		if (score.i === game.playerIndex) {
			const lostArmies = (game.myScore.total >= score.total) ? true : false;
			const lostTerritory = (game.myScore.tiles < score.tiles) ? true : false;

			game.myScore = {...score, lostArmies, lostTerritory};
		} else if (!score.dead) {
			game.opponents[score.i] = {color: COLOR_MAP[score.color], dead: score.dead, tiles: score.tiles, total: score.total};

			if (game.generals[score.i] !== -1) {
				game.opponents[score.i].generalLocationIndex = game.generals[score.i]
			}
		} else {
			game.opponents[score.i] = null;
		}

		return null;
	});

	// Avoid resetting game constants every update
	if (!game.mapSize) {
		// The first two items in |map| are the map width and height dimensions.
		game.mapWidth = game.map[0];
		game.mapHeight = game.map[1];
		game.mapSize = game.mapWidth * game.mapHeight;
	}

  // The next |size| entries of map are army values.
  // armies[0] is the top-left corner of the map.
  game.armies = game.map.slice(2, game.mapSize + 2);

  // The last |game.mapSize| of map are terrain values.
  // terrain[0] is the top-left corner of the map.
	// EMPTY: -1, MTN: -2, FOG: -3, FOG_MTN: -4
	// Any tile with a nonnegative value is owned by the player corresponding to its value.
	// For example, a tile with value 1 is owned by the player with playerIndex = 1.
  game.terrain = game.map.slice(game.mapSize + 2, game.mapSize + 2 + game.mapSize);

	game.turn = rawData.turn;

	// TODO: Consider just passing game in an init function to save as a `this.property` inside of `ai`, so that we don't pass it around everywhere.
	ai.move(game);

});


