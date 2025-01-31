import io from 'socket.io-client'
import MurderBot from './bots/murderbot'
import EnigmaBot from './bots/enigmabot'
import FinderBot from './bots/finderBot'
import NotWorthItBot from './bots/notWorthItBot'
import config from './config'

let forceStartFlag = false
let game = {}
let ai
let gameLog=""

const BOT_MAP = {
	"MurderBot": MurderBot,
	"EnigmaBot": EnigmaBot,
	"NotWorthItBot": NotWorthItBot,
	"FinderBot": FinderBot,
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

const TERRAIN_EMPTY = -1    // empty or city or enemy
const TERRAIN_MTN = -2      // viewable mountain
const TERRAIN_FOG = -3     // empty or swamp or occupied
const TERRAIN_FOG_MTN = -4 // city or mnt


export function addGameLog(textLine) {
	//document.getElementById("log").append(`\n${textLine}`)
	gameLog =`${textLine}\n` + gameLog
	document.getElementById("log").innerHTML = gameLog
}

export function ForceStart () {
	setTimeout(()=> {
		forceStartFlag = !forceStartFlag
		addGameLog(`Toggled force_start: ${forceStartFlag}`)
		socket.emit('set_force_start', config.GAME_ID, forceStartFlag)
	}, 100) // Keep from firing join and force_start events simultaneously
}

export function Join (userID, username) {
	gameLog = "Connected to lobby: " + config.GAME_ID;
	document.getElementById("log").innerHTML = gameLog
	addGameLog(`Joined custom game at http://bot.generals.io/games/${encodeURIComponent(config.GAME_ID)}`)
	socket.emit('join_private', config.GAME_ID, userID)

	// When you're ready, you can have your bot join other game modes.
	// Here are some examples of how you'd do that:

	// Join the 1v1 queue.
	// socket.emit('join_1v1', user_id)

	// Join the FFA queue.
	// socket.emit('play', user_id)

	// Join a 2v2 team.
	// socket.emit('join_team', 'team_name', user_id)
}

export function Quit () {
	addGameLog(`Replay: ${game.replay_url}`)
	addGameLog(`Game over. Halting execution until next game begin.`)
	game.gameOver = true
	forceStartFlag = false
	socket.emit('leave_game') // Leave active game
	// socket.emit('cancel') // Leave queue
}

export function Team (gameId, team) {
	socket.emit('set_custom_team', gameId, team)
	addGameLog(`Team ${team} joined`)
}

export function ChooseBotVariant (botVariant) {
	if (BOT_MAP[botVariant]) {
		ai = BOT_MAP[botVariant]
		addGameLog(`${botVariant} selected`)
	} else {
		ai = BOT_MAP.MurderBot
		addGameLog(`Unrecognized bot variant '${botVariant}' selected. Defaulting to MurderBot`)
	}
}

let socket = io("wss://botws.generals.io")

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

// This happens on socket timeout, or after leaving the window open while letting the computer go to sleep.
socket.on('disconnect', function() {
	addGameLog(`Game disconnected.`)
})

socket.on('connect', function() {
	// Setting the bot name only needs to be done once, ever. See API for more details.
	// socket.emit('set_username', config.BOT_USER_ID, config.BOT_NAME)
	// socket.emit('play', config.BOT_USER_ID) // Join the FFA queue
})

socket.on('game_lost', () => {
	addGameLog(`Game lost...disconnecting.\nClick Join Game to rejoin for a rematch.`)

	sendVoiceLine('FAILURE')
	Quit()
})

socket.on('game_won', () => {
	addGameLog(`Game won!`)

	sendVoiceLine('SUCCESS')
	Quit()
})
/**
 * @startData.playerIndex    - A nonnegative integer used to identify the player in all data related to this game.
 * @startData.replay_id      - The replay id for this game. Used to watch the replay after the game.
 * @startData.chat_room      - A string used to send and receive messages during this game.
 * @startData.team_chat_room - A string used to send and receive team chat messages during this game, if applicable.
 * @startData.usernames      - An array of usernames of players, ordered by each player's {playerIndex}.
 * @startData.teams          - An array of team affiliations of players, if applicable. Ordered by {playerIndex}. If not supplied, each player is
 * on their own team (meaning the game is a free-for-all).
 */
socket.on("game_start", function(startData) {
	// TODO: Take teammates from startData.teams into account & keep separate from opponents
	addGameLog(`Game starting...`)
	// Initialize/Re-initialize game state used by both bot and client.
	game = {
		socket,
		chatRoom: null,
		map: [],
		locations: [],
		locationObjectMap: [],
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
		teams: null,
		turn: 0,
		gameOver: false,
		replay_url: null,
		usernames: [], // Ordered by playerIndex
	}

	game.playerIndex = startData.playerIndex

  game.replay_url = "http://bot.generals.io/replays/" + encodeURIComponent(startData.replay_id)
	document.getElementById("log").insertAdjacentText("beforebegin", `Game starting! The replay will be available after the game at ${game.replay_url}\n`)
	game.teams = startData.teams
	game.team = startData.teams[startData.playerIndex]

	const startDataString = JSON.stringify(startData.teams)
	addGameLog(`teams: ${startDataString}`)
	game.usernames = startData.usernames
	game.chatRoom = startData.chat_room

	sendVoiceLine('START')

	ai.init(game)
})

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
/**
 * @UpdataData.turn        - An integer representing what turn the game is on. Note that this value increments at a rate of 2/sec, whereas the turn
 * counter in-game increments at 1/sec.
 * @updateData.map_diff    - A patch representing the diff between the current map state and the last map state. See "Handling Game Updates" in the
 * tutorial for details on applying the patch.
 * @updateData.cities_diff -  except for the array of currently visible cities
 * @updateData.generals    - An array of generals ordered by {playerIndex} (if you don't know what that is, see ). Each element is an integer
 * representing the index of that general, where index 0 is the top left corner. Generals that aren't visible are marked by a -1.
 * @updateData.scores      - An array of objects representing the current scores (# tiles, total army) of each player. Each object has a field named
 * {i} that contains the {playerIndex} of the player corresponding to the score object.
 * @updateData.stars       - An array of star ratings of players ordered by {playerIndex} . The array may be incomplete to begin with. This field
 * will be included in game updates until the entire array is complete. Thus, you should only use the last instance of this array received.
 */
socket.on("game_update", function(updateData) {
  // Patch the city and map diffs into our local variables.
  game.map = patch(game.map, updateData.map_diff)
  game.cities = patch(game.cities, updateData.cities_diff) // TODO: keep a history of known city locations.
	game.myGeneralLocationIndex = updateData.generals[game.playerIndex]
	game.generals[game.playerIndex] = -1 // Remove our own general from the list, to avoid confusion.

	// Keep track of general locations, if discovered, even if no longer visible.
	for (let idx = 0; idx < updateData.generals.length; idx++) {
		const generalLocation = updateData.generals[idx]

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
	updateData.scores.map((score) => {
		if (score.i === game.playerIndex) {
			const lostArmies = (game.myScore.total >= score.total) ? true : false
			const lostTerritory = (game.myScore.tiles < score.tiles) ? true : false

			game.myScore = {...score, lostArmies, lostTerritory}
		} else if (!score.dead) {
			let gatherableArmies = score.total
			let landSetsOfFifty = Math.floor(score.tiles/50)
			// adjust for each set of 50 land (1*50+2*50+3*50)
			// for every 50 moves to gather onother army is added to the land that wont be gathered.
			for(let i = landSetsOfFifty; i>0; i--) {
				gatherableArmies = gatherableArmies - (50 * i)
			}
			// adjust for remaining land
			gatherableArmies = gatherableArmies = (score.tiles%50)*(landSetsOfFifty+1)
			game.opponents[score.i] = {
				idx: score.i,
				color: COLOR_MAP[score.color],
				dead: score.dead,
				tiles: score.tiles,
				total: score.total,
				availableArmies: (score.total-score.tiles),
				gatherableArmies: gatherableArmies,
				isTeam: game.teams[score.i] === game.team
			}

			if (game.opponents[score.i] && game.generals[score.i] !== -1) {
				if (game.opponents[score.i].generalLocationIndex !== game.generals[score.i]) {
					game.opponents[score.i].generalLocationIndex = game.generals[score.i]

					// TODO: Only log this once, and only ping every ten turns.
					// console.log(`FOUND ${COLOR_MAP[score.i]} GENERAL AT: ${game.generals[score.i]}`)
					// socket.emit('ping_tile', game.generals[score.i])
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

	function makeLocationObject(locationIdx) {
		const terrain = game.terrain[locationIdx]
		game.locations[locationIdx] = {
			idx: locationIdx,
			armies: game.armies[locationIdx],
			terrain: terrain,
			isMine: terrain === game.playerIndex,
			isTeam: game.teams[terrain] === game.team,
			attackable: terrain === TERRAIN_EMPTY || (terrain > TERRAIN_EMPTY && terrain !== game.playerIndex && game.teams[terrain] !== game.team),
			isCity: game.knownCities.includes(locationIdx),
			isGeneral: game.opponents.some(opponent => opponent.generalLocationIndex && opponent.generalLocationIndex === locationIdx && !opponent.dead),
		}
		return game.locations[locationIdx]
	}

	// Loop through map array once, and sort all data appropriately.
	// const row = Math.floor(idx / this.game.mapWidth)
	// const col = idx % this.game.mapWidth
	// const index = row * this.game.mapWidth + col
	for (let row = 0; row < Math.floor(game.terrain.length / game.mapWidth); row++) {
		game.locationObjectMap[row] = []
		for (let column = 0; column <= (game.terrain.length - 1) % game.mapWidth; column++) {
			const locationIdx = row * game.mapWidth + column
			game.locationObjectMap[row][column] = makeLocationObject(locationIdx)
		}
	}

	game.turn = updateData.turn

	ai.move()
})
