import {createDistanceMap, findPath, findNeighbors, getLocationObject, makeAttackQueueObject} from './botUtils'
import {TERRAIN_EMPTY, TERRAIN_FOG} from './botUtils'
import {addGameLog} from "../client";
/**
 * This bot expands and pulls all other armies back to the general
 *
 */
const OPENING_FIRST_MOVE_THRESHOLD = 24  //24 game ticks = 12 armies
const OPENING_GAME_TURN_THRESHOLD = 50
const USEFUL_ARMY_THRESHOLD = 2

let ai = {
  game: undefined, // TODO: If we make the data arrays into sets, we don't have to worry about pushing repeat state, like known city locations
  intel: {
    attackQueue: [],
    myGeneral : {},
    distanceMapFromGeneral : [],
    myTopArmies: [], // The map locations we own and have a minimum number of armies available.
    log: Array(5), // Set up limited-length history, with turn info, foreign policy, and other important data to track over time.
  },

  init: function (game) {
    this.game = game
  },

  /**
   * Taking all game data into account, plan and execute moves.
   */
  move: function () {
    this.determineIntel()
    this.determineMoves()

    if (this.intel.attackQueue.length > 0) {
      // AS LONG AS FOREIGN POLICY DOES NOT DRAMATICALLY CHANGE, WORK THROUGH FIFO QUEUE OF MOVES
      let currentMove = this.intel.attackQueue.shift()
      let moveInfo = `TURN ${this.game.turn}: ${currentMove.mode}: ${currentMove.attackerIndex} --> ${currentMove.targetIndex} ${(currentMove.sendHalf) ? ' (HALF)' : ''}`
      addGameLog(`${moveInfo}`)
      this.intel.log.unshift({mode: currentMove.mode, attackerIndex: currentMove.attackerIndex, targetIndex: currentMove.targetIndex}) // push to front of log array--returns new length
      this.intel.log.length = 5
      this.game.socket.emit("attack", currentMove.attackerIndex, currentMove.targetIndex, currentMove.sendHalf)
    }
  },

  /**
   * Calculate intel based on board state.
   */
  determineIntel: function () {
    this.parseMap()
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
    if (this.intel.attackQueue.length > 0 ) {
      let nextAttacker = getLocationObject({locationIdx : this.intel.attackQueue[0].attackerIndex, game : this.game})
      let nextTarget = getLocationObject({locationIdx : this.intel.attackQueue[0].targetIndex, game : this.game})
      if (!nextAttacker.isMine || nextAttacker.armies < 2 || (nextAttacker.armies-1 <= nextTarget.armies && !nextTarget.isMine)) {
        this.intel.attackQueue = []
      }
    }

    //Easy wins
    if (this.intel.attackQueue.length < 1) {
      let useArmies
      if (this.game.turn <= OPENING_GAME_TURN_THRESHOLD) {
        useArmies = this.intel.myTopArmies
      } else {
        useArmies = this.intel.myTopArmies.filter((location) => location.idx !== this.intel.myGeneral.idx).sort((a, b) => b.armies - a.armies)
      }
      this.queueEasyWins(useArmies)
    }
    //Gather everything to general
    // find largest army
    // move to king
    // Don't queue up new stuff if there is stuff to do.
    if (this.intel.attackQueue.length < 1) {
      // move largest army to random empty Territory
      let aTopArmy = this.intel.myTopArmies.filter((location) => location.idx !== this.intel.myGeneral.idx).sort((a, b) => {
        let result = 0
        if(!result) {
          result = (b.armies-b.isCity*24) - (a.armies-a.isCity*24)
        }
        if(!result) {
          result = this.intel.distanceMapFromGeneral[b.idx] - this.intel.distanceMapFromGeneral[a.idx]
        }
        return result
      }
      )[0]
      this.queuePathToTarget(aTopArmy, this.intel.myGeneral, "GatherToGeneral", 20)
    }
  },

  /**
   * Adds to attackQueue a move for every 'availableArmies' that can win a fight with a neighboring tile
   *
   * Check for cities first. Then hit smallestNeighbor first (best and easiestWin)
   * This creates a follow back to source priority
   * @param availableArmies (recommended sorted largest to smallest)
   */

  queueEasyWins(availableArmies) {
    for(let i = 0; i<availableArmies.length; i++) {
      let neighbors = findNeighbors({location: availableArmies[i], game: this.game}).sort((a, b) => {
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

  queuePathToTarget: function(attacker, targetLocation, mode, priority){
    const nextMoveLocations = findPath({location: attacker, targetLocation, game : this.game})
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
   * Extract map state into actionable data.
   * Locations matching playerIndex and a count >= USEFUL_ARMY_THRESHOLD map to standingArmies.
   * Locations with a terrain index != playerIndex are enemy locations.
   */
  parseMap: function () {

    this.intel.myTopArmies = []
    this.intel.totalAvailableArmyPower = 0

    for (let idx = 0; idx < this.game.terrain.length; idx++) {
      if (this.game.terrain[idx] === this.game.playerIndex) {
        if (this.game.armies[idx] > 1) {
          this.intel.totalAvailableArmyPower += this.game.armies[idx] - 1
        }
      }
    }

    this.intel.emptyTerritories = this.game.locations.filter((location) => location.terrain === TERRAIN_EMPTY)
    this.intel.myTopArmies = this.game.locations.filter((location) => location.isMine && location.armies >= USEFUL_ARMY_THRESHOLD).sort((a, b) => b.armies - a.armies)
    this.intel.myGeneral = getLocationObject({locationIdx : this.game.myGeneralLocationIndex, game : this.game})
    this.intel.distanceMapFromGeneral = createDistanceMap({location : this.intel.myGeneral, game : this.game})
  }
}

export default ai