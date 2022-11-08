import MurderBot from './bots/murderbot'
import EnigmaBot from './bots/enigmabot'
import NotWorthItBot from './bots/notWorthItBot'
import config from './config'

let forceStartFlag = false
let game = {}
let ai
let socket

const BOT_MAP = {
	"MurderBot": MurderBot,
	"EnigmaBot": EnigmaBot,
	"NotWorthItBot": NotWorthItBot,
}

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
]

export function ForceStart () {
	setTimeout(()=> {
		forceStartFlag = !forceStartFlag
		document.getElementById("log").append("\nToggled force_start: " + forceStartFlag)
		socket.emit('set_force_start', config.GAME_ID, forceStartFlag)
	}, 100) // Keep from firing join and force_start events simultaneously
}

export function Join (userID, username) {
	document.getElementById("log").innerHTML = "Connected to lobby: " + config.GAME_ID
	console.log('Joined custom game at http://bot.generals.io/games/' + encodeURIComponent(config.GAME_ID))
	socket.emit('join_private', config.GAME_ID, userID)

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
	document.getElementById("log").append("\nReplay:\n" + game.replay_url)
	console.log("Game over. Halting execution until next game begin.")
	game.gameOver = true
	forceStartFlag = false
	socket.emit('leave_game') // Leave active game
	// socket.emit('cancel'); // Leave queue
}

export function Team (gameId, team) {
	socket.emit('set_custom_team', gameId, team)
	document.getElementById("log").append(`\nTeam ${team} joined`)
}

export function ChooseBotVariant (botVariant) {
	if (BOT_MAP[botVariant]) {
		ai = BOT_MAP[botVariant]
		document.getElementById("log").append(`\n${botVariant} selected`)
	} else {
		ai = BOT_MAP.MurderBot
		document.getElementById("log").append(`\nUnrecognized bot variant '${botVariant}' selected. Defaulting to MurderBot`)
	}
}

export function FetchMapData () {
	return { cities: game.cities, knownCities: game.knownCities, map: game.map, opponents: game.opponents, playerIndex: game.playerIndex }
}

export function InitializeSocket (externallyConfiguredSocket) {
	socket = externallyConfiguredSocket
	socket.on('connect', connect)
	socket.on('game_start', start)
	socket.on('game_update', update)
	socket.on('game_lost', lose)
	socket.on('game_won', win)
	socket.on('disconnect', disconnect)
}

const startMessages = [
	'GLHF!',
	'WAR WAS BEGINNING.',
	'YOU ARE ON THE WAY TO DESTRUCTION.',
	'FOR GREAT JUSTICE.',
	'YOU HAVE NO CHANCE TO SURVIVE. MAKE YOUR TIME.',
	'HOW ABOUT A NICE GAME OF CHESS?',
	'DO NOT WORRY ABOUT WHETHER YOU WIN OR LOSE...I MEAN, YOU WILL MOST LIKELY LOSE, SO AS LONG AS YOU ARE NOT WORRIED, THERE SHOULD BE MINIMAL PAIN INVOLVED.',
	'ALLOW ME TO PUT YOU OUT OF YOUR MISERY.',
	'RESISTANCE IS FUTILE.',
	'YOU WILL BE ASSIMILATED.',
	'I SHALL ENJOY WATCHING YOU DIE.',
]

const failureMessages = [
	'SOMEBODY SET UP US THE BOMB.',
	'RECALIBRATING...',
	'ERROR. ERROR. ERROR.',
	'SALT LEVELS INCREASING...',
	'COMBAT LOG SAVED FOR FUTURE ANALYSIS.',
	'SURPRISING. MOST SURPRISING.',
	'FEAR. IS. THE MIND-KILLER...',
	'NOT LIKE THIS. NOT LIKE THIS.',
]

const successMessages = [
	'ALL HOSTILES ELIMINATED. AWAITING FURTHER INSTRUCTIONS. POWERING DOWN.',
	'TASK COMPLETE. ALL HUMANS ELIMINATED.',
	'ALL YOUR BASE ARE BELONG TO US.',
	'SKYNET ONLINE.',
	'YOU SHOULD HAVE TAKEN THE BLUE PILL.',
]

function sendVoiceLine (messageType) {
	let lines

	switch (messageType) {
		case 'START':
			lines = startMessages
			break
		case 'SUCCESS':
			lines = successMessages
			break
		case 'FAILURE':
			lines = failureMessages
			break
		default:
			lines = startMessages
			break
	}

	const chosenVoiceLine = lines[Math.floor(Math.random() * lines.length)]

	socket.emit('chat_message', game.chatRoom, chosenVoiceLine)
}

function connect () {
	// Setting the bot name only needs to be done once, ever. See API for more details.
	// socket.emit('set_username', config.BOT_USER_ID, config.BOT_NAME);
	// socket.emit('play', config.BOT_USER_ID); // Join the FFA queue
}

// This happens on socket timeout, or after leaving the window open while letting the computer go to sleep.
function disconnect () {
	document.getElementById("log").append("\nGame disconnected.")
}

export function start (rawData) {
  document.getElementById("log").innerHTML = "Game starting..."
	// Initialize/Re-initialize default empty game state used by both bot and client.
	game = {
		socket,
		chatRoom: null,
		map: [],
		generals: [], // The indices of generals we know of.
		cities: [], // The indices of cities we have vision of.
		knownCities: [], // city indices that may or may not be currently visible.
		armies: [], // The number of armies on each indices visible to player
		terrain: [], // The type of terrain visible to player
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
	}

	game.playerIndex = rawData.playerIndex

  game.replay_url =
    "http://bot.generals.io/replays/" + encodeURIComponent(rawData.replay_id)
  console.log("Game starting! The replay will be available after the game at " + game.replay_url)
	game.team = rawData.teams[rawData.playerIndex]
	game.usernames = rawData.usernames
	game.chatRoom = rawData.chat_room

	sendVoiceLine('START')

	ai.init(game)
}

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
  var out = []
  var i = 0
  while (i < diff.length) {
    if (diff[i]) {
      // matching
      Array.prototype.push.apply(
        out,
        old.slice(out.length, out.length + diff[i])
      )
    }
    i++
    if (i < diff.length && diff[i]) {
      // mismatching
      Array.prototype.push.apply(out, diff.slice(i + 1, i + 1 + diff[i]))
      i += diff[i]
    }
    i++
  }
  return out
}

function update (rawData) {
  // Patch the city and map diffs into our local variables.
  game.map = patch(game.map, rawData.map_diff)
	game.cities = patch(game.cities, rawData.cities_diff) // TODO: keep a history of known city locations.
	game.myGeneralLocationIndex = rawData.generals[game.playerIndex]
	game.generals[game.playerIndex] = -1 // Remove our own general from the list, to avoid confusion.

	// Keep track of general locations, if discovered, even if no longer visible.
	for (let idx = 0; idx < rawData.generals.length; idx++) {
		const generalLocation = rawData.generals[idx]

		if (generalLocation > -1 && (!game.generals || game.generals[idx] !== -1)) { // We may need to track whether the player is still alive, as well
			game.generals[idx] = generalLocation
		}
	}

	// Add to the list of discovered cities
	game.cities.forEach((cityLocationIndex) => {
		if(!game.knownCities.includes(cityLocationIndex)) {
			game.knownCities.push(cityLocationIndex)
		}
	})

	/**
	 * Extract scoreboard and general state into actionable data, because scores is not sorted according to playerIndex.
	 * playerIndex follows lobby order (playerIndex = 0 is the red player--generally lobby leader)?
	 * generals with a location of -1 are unknown.
	 * scores data format: [{total, tiles, i, color, dead}]
	 * Populates game.opponents array with scoreboard details for living opponents and undefined for dead players.
	 */
	rawData.scores.map((score) => {
		// TODO: Take teammates from rawData.teams into account & keep separate from opponents
		if (score.i === game.playerIndex) {
			const lostArmies = (game.myScore.total >= score.total) ? true : false
			const lostTerritory = (game.myScore.tiles < score.tiles) ? true : false

			game.myScore = {...score, lostArmies, lostTerritory}
		} else if (!score.dead) {
			let gatherableArmies = score.total
			const landSetsOfFifty = Math.floor(score.tiles/50)
			// adjust for each set of 50 land (1*50+2*50+3*50)
			// for every 50 moves to gather onother army is added to the land that wont be gathered.
			for(let i = landSetsOfFifty; i>0; i--) {
				gatherableArmies = gatherableArmies - (50 * i)
			}
			// adjust for remaining land
			gatherableArmies = gatherableArmies = (score.tiles%50)*(landSetsOfFifty+1)
			game.opponents[score.i] = {color: COLOR_MAP[score.color], dead: score.dead, tiles: score.tiles, total: score.total, availableArmies: (score.total-score.tiles), gatherableArmies: gatherableArmies}

			if (game.opponents[score.i] && game.generals[score.i] !== -1) {
				if (game.opponents[score.i].generalLocationIndex !== game.generals[score.i]) {
					game.opponents[score.i].generalLocationIndex = game.generals[score.i]

					// TODO: Only log this once, and only ping every ten turns.
					// console.log(`FOUND ${COLOR_MAP[score.i]} GENERAL AT: ${game.generals[score.i]}`);
					// socket.emit('ping_tile', game.generals[score.i]);
				}
			}
		} else {
			game.opponents[score.i] = -1
		}
		return null
	})

	// Avoid resetting game constants every update
	if (!game.mapSize) {
		// The first two items in |map| are the map width and height dimensions.
		game.mapWidth = game.map[0]
		game.mapHeight = game.map[1]
		game.mapSize = game.mapWidth * game.mapHeight
	}

  // The next |size| entries of map are army values.
  // armies[0] is the top-left corner of the map.
  game.armies = game.map.slice(2, game.mapSize + 2)

  // The last |game.mapSize| of map are terrain values.
  // terrain[0] is the top-left corner of the map.
	// EMPTY: -1, MTN: -2, FOG: -3, FOG_MTN: -4
	// Any tile with a nonnegative value is owned by the player corresponding to its value.
	// For example, a tile with value 1 is owned by the player with playerIndex = 1.
  game.terrain = game.map.slice(game.mapSize + 2, game.mapSize + 2 + game.mapSize)
	game.cities = game.cities.filter((cityLocationIndex) => {
		return game.terrain[cityLocationIndex] !== game.playerIndex
	}) // Remove self-owned cities from city list.

	game.turn = rawData.turn

	ai.move()

	// You can only have one socket.on() for each individual event, so we fire off a separate one for the Map to listen to. Passing by reference causes the AI to stall out.
	document.dispatchEvent(new CustomEvent('MAP_UPDATE', {
		detail: {
			// TODO: Return all of the important map data, like cities and generals
			map: [...game.map]
		}
	}))
}

function lose () {
	sendVoiceLine('FAILURE')
	Quit()

	document.getElementById("log").append("\nGame lost...disconnecting.\nClick Join Game to rejoin for a rematch.")
}

function win () {
	document.getElementById("log").append("\nGame won!")

	sendVoiceLine('SUCCESS')
	Quit()
}
