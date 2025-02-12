import {createDistanceMap, findPath, findNeighbors, getLocationObject, makeAttackQueueObject} from './botUtils'
import {TERRAIN_EMPTY, TERRAIN_FOG} from './botUtils'
import {addGameLog} from "../client";
/**
 * This bot randomly moves its largest army to a random foggy location
 *
 */
const OPENING_FIRST_MOVE_THRESHOLD = 24  //24 game ticks = 12 armies
const USEFUL_ARMY_THRESHOLD = 2

const ai = {
  game: undefined, // TODO: If we make the data arrays into sets, we don't have to worry about pushing repeat state, like known city locations
  intel: {
    map: [],
    locations: [],
    attackQueue: [],
    opponents: [],
    myScore: {total: 0, tiles: 0, lostArmies: false, lostTerritory: false},
    behindInLand : false,
    myGeneral : {},
    myTopArmies: [], // The map locations we own and have a minimum number of armies available.
    emptyTerritories: [], // The map locations we can see that are free to conquer.
    foggedTerritories: [],
    visibleOpponentTerritories: [],
    discoveredCities: [], // List of all cities that have been found during the game.  City may be currently fogged.
    unexploredTerritories: [], // The set of remaining board indices we have not yet explored while searching for generals.
    log: Array(5), // Set up limited-length history, with turn info, foreign policy, and other important data to track over time.

  },

  init: function (game) {
    this.game = game
  },

  /**
   * Taking all game data into account, plan and execute moves.
   * @param {*} game - The game state that we determine actions from.
   */
  move: function () {
    this.determineIntel()
    this.determineMoves()

    // while (this.intel.attackQueue.length) {
    if (this.intel.attackQueue.length > 0) {
      // AS LONG AS FOREIGN POLICY DOES NOT DRAMATICALLY CHANGE, WORK THROUGH FIFO QUEUE OF MOVES
      const currentMove = this.intel.attackQueue.shift()
      const moveInfo = `TURN ${this.game.turn}: ${currentMove.mode}: ${currentMove.attackerIndex} --> ${currentMove.targetIndex} ${(currentMove.sendHalf) ? ' (HALF)' : ''}`
      addGameLog(`${moveInfo}`)
      this.intel.log.unshift({mode: currentMove.mode, attackerIndex: currentMove.attackerIndex, targetIndex: currentMove.targetIndex}) // push to front of log array--returns new length
      this.intel.log.length = 5
      this.game.socket.emit("attack", currentMove.attackerIndex, currentMove.targetIndex, currentMove.sendHalf)
    }
  },

  /**
   * Calculate queue of attack moves to accomplish foreignPolicy goal
   */
  determineMoves: function () {

    if (this.game.turn <= OPENING_FIRST_MOVE_THRESHOLD) {
      // Build armies at first
      return
    }

    // Clear the queue if the next action no longer makes sense
    if (this.intel.attackQueue.length > 0) {
      const nextAttacker = getLocationObject({locationIdx: this.intel.attackQueue[0].attackerIndex, game: this.game})
      const nextTarget = getLocationObject({locationIdx: this.intel.attackQueue[0].targetIndex, game: this.game})
      if (!nextAttacker.isMine || nextAttacker.armies < 2 || (nextAttacker.armies - 1 <= nextTarget.armies && !nextTarget.isMine && this.intel.attackQueue[0].priority < 10)) {
        this.intel.attackQueue = []
      }
    }

    // Take the general instead of current action
    if (this.intel.attackQueue.length > 0 && this.intel.attackQueue[0].priority < 100) {
      const nextAttacker = getLocationObject({locationIdx: this.intel.attackQueue[0].attackerIndex, game: this.game})
      const neighbors = findNeighbors({location: nextAttacker, game: this.game})
      for (let n = 0; n < neighbors.length; n++) {
        if (neighbors[n].attackable && nextAttacker.armies > neighbors[n].armies + 1 && neighbors[n].isGeneral) {
          //Clear the queue and make this the thing to do
          this.intel.attackQueue = []
          this.intel.attackQueue.push(makeAttackQueueObject({
            mode: "oopsIFoundYou", attacker: nextAttacker, target: neighbors[n], priority: 100
          }))
          break //Only queue one for each attacker
        }
      }
    }

    // seek and destroy generals
    if ((this.intel.attackQueue.length > 0 && this.intel.attackQueue[0].priority < 10) || this.intel.attackQueue.length === 0) {
      for (let n = 0; n < this.game.opponents.length; n++) {
        if (this.game.opponents[n] && typeof this.game.opponents[n].generalLocationIndex !== 'undefined' && this.game.opponents[n].generalLocationIndex > -1 && !this.game.opponents[n].dead && !this.game.opponents[n].isTeam) {
          this.intel.attackQueue = []
          this.queuePathToTarget(this.intel.myArmies[0], this.game.opponents[n].generalLocationIndex, "SeekAndDestroy", 10)
          break
        }
      }
    }

    // Check current low priority attacker and take the city instead of current action
    if (this.intel.attackQueue.length > 0 && this.intel.attackQueue[0].priority < 1) {
      const nextAttacker = getLocationObject({locationIdx: this.intel.attackQueue[0].attackerIndex, game: this.game})
      const neighbors = findNeighbors({location: nextAttacker, game: this.game})
      for (let n = 0; n < neighbors.length; n++) {
        if (neighbors[n].attackable && nextAttacker.armies > neighbors[n].armies + 1 && neighbors[n].isCity) {
          //Clear the queue and make this the thing to do
          this.intel.attackQueue = []
          this.intel.attackQueue.push(makeAttackQueueObject({
            mode: "CityPriority",
            attacker: nextAttacker,
            target: neighbors[n],
            sendHalf: nextAttacker.armies / 2 > neighbors[n].armies + 1,
            priority: 1
          }))
          break //Only queue one for each attacker
        }
      }
    }

    // only do this if player is not ahead in land.
    if (this.intel.attackQueue.length < 1 && (this.game.myScore.tiles < 50 || this.intel.behindInLand || this.game.turn%50>40)) {
      this.queueEasyWins(this.intel.myTopArmies)
    }

    // Don't queue up new stuff if there is stuff to do.
    if (this.intel.attackQueue.length < 1 && this.intel.visibleOpponentTerritories.length > 0 && (this.game.myScore.tiles < 50 || this.intel.behindInLand || this.game.turn%50>40)) {
      // move largest army to random enemy Territory
      const random = Math.floor(Math.random() * this.intel.visibleOpponentTerritories.length)
      const attacker = this.intel.myArmies[0] // largest army
      const target = this.intel.visibleOpponentTerritories[random]
      if(attacker && attacker.armies > target.armies+1) {
        this.queuePathToTarget(attacker, target, "AttackBoarder")
      }
    }

    // Don't queue up new stuff if there is stuff to do.
    if (this.intel.attackQueue.length < 1 && this.intel.visibleOpponentTerritories.length > 0) {
      // move largest army to random enemy Territory
      const random = Math.floor(Math.random() * this.intel.visibleOpponentTerritories.length)
      this.queuePathToTarget(this.intel.myArmies[0], this.intel.visibleOpponentTerritories[random], "AttackBoarder")
    }

    // Don't queue up new stuff if there is stuff to do.
    if (this.intel.attackQueue.length < 1 && this.intel.foggedTerritories.length > 0) {
      // move largest army to random empty Territory
      const random = Math.floor(Math.random() * this.intel.foggedTerritories.length)
      this.queuePathToTarget(this.intel.myArmies[0], this.intel.foggedTerritories[random], "RandomEmpty")
    }
  },

  queuePathToTarget: function(attacker, targetLocation, mode, priority, noCities){
    const nextMoveLocations = findPath({location: attacker, targetLocation, game : this.game, noCities})
    for (let i = nextMoveLocations.length - 1; i > 0; i--) {
      this.intel.attackQueue.push(makeAttackQueueObject({
        mode: mode || "SelectedPathToTarget",
        attacker: nextMoveLocations[i],
        target: nextMoveLocations[i - 1],
        priority: priority || 0
      }))
    }
  },

  /**
   * Adds to attackQueue a move for every 'availableArmies' that can win a fight with a neighboring tile
   *
   * Check for cities first. Then hit smallestNeighbor first (best and easiestWin)
   * This creates a follow back to source priority
   * @param availableArmies (recommended sorted largest to smallest)
   */
  queueEasyWins: function(availableArmies) {
    for(let i = 0; i<availableArmies.length; i++) {
      const neighbors = findNeighbors({ location : availableArmies[i], game : this.game }).sort((a, b) => {
        let result = a.isCity
        if(!result) {
          result = a.armies - b.armies
        }
        return result
      })
      for(let n = 0; n<neighbors.length; n++) {
        if(neighbors[n].attackable && availableArmies[i].armies > neighbors[n].armies+1) {
          this.intel.attackQueue.push(makeAttackQueueObject({
            mode: "EasyWin",
            attacker: availableArmies[i],
            target: neighbors[n]
          }))
          return //Only queue one for each attacker
        }
      }
    }
  },

  /**
   * Calculate intel based on board state.
   */
  determineIntel: function () {
    this.parseMap()
  },

  /**
   * Extract map state into actionable data.
   * Locations with a -1 map to emptyTerritories.
   * Locations matching playerIndex and a count >= USEFUL_ARMY_THRESHOLD map to standingArmies.
   * Locations with a terrain index != playerIndex are enemy locations.
   */
  parseMap: function () {

    if (this.game.turn === 1) {
      this.intel.unexploredTerritories = new Set([...Array(this.game.mapSize).keys()])
    }

    this.intel.emptyTerritories = []
    this.intel.foggedTerritories = []
    this.intel.visibleOpponentTerritories = []
    this.intel.myArmies = []
    this.intel.myTopArmies = []
    this.intel.totalAvailableArmyPower = 0

    for (let idx = 0; idx < this.game.terrain.length; idx++) {
      if (this.game.terrain[idx] === this.game.playerIndex) {
        this.intel.unexploredTerritories.delete(idx)
        if (this.game.armies[idx] > 1) {
          this.intel.totalAvailableArmyPower += this.game.armies[idx] - 1
        }
      }
    }

    if(this.game.opponents.length < 0 ) {
      for (let i = 0; i < this.game.opponents.length; i++) {
        if (this.game.opponents[i].tiles > this.game.myScore.tiles) {
          this.intel.behindInLand = true
        }
      }
    }

    this.intel.emptyTerritories = this.game.locations.filter((location) => location.terrain === TERRAIN_EMPTY)
    this.intel.foggedTerritories = this.game.locations.filter((location) => location.terrain === TERRAIN_FOG)
    this.intel.visibleOpponentTerritories = this.game.locations.filter((location) => location.terrain > TERRAIN_EMPTY && location.terrain !== this.game.playerIndex && this.game.teams[location.terrain] !== this.game.team)
    // sort() so that our largest army will be at the front of the array.
    this.intel.myArmies = this.game.locations.filter((location) => location.isMine).sort((a, b) => b.armies - a.armies)
    this.intel.myTopArmies = this.game.locations.filter((location) => location.isMine && location.armies >= USEFUL_ARMY_THRESHOLD).sort((a, b) => b.armies - a.armies)
    this.intel.myGeneral = getLocationObject({ locationIdx : this.game.myGeneralLocationIndex, game : this.game })
  },


}

export default ai
