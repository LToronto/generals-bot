import {createDarknessMap, findPath, getLocationObject, makeAttackQueueObject} from './botUtils'
import {addGameLog} from "../client";

/**
 * This bot follows its own path to discover stratigic fogged area
 *
 */
const OPENING_FIRST_MOVE_THRESHOLD = 24  //24 game ticks = 12 armies
const USEFUL_ARMY_THRESHOLD = 2

const ai = {
  game: undefined, // TODO: If we make the data arrays into sets, we don't have to worry about pushing repeat state, like known city locations
  intel: {
    attackQueue: [],
    darknessMap: [],
    myTopArmies: [],
    myGeneral: {},
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

    if (this.intel.attackQueue.length > 0) {
      const nextAttacker = getLocationObject({locationIdx: this.intel.attackQueue[0].attackerIndex, game: this.game})
      const nextTarget = getLocationObject({locationIdx: this.intel.attackQueue[0].targetIndex, game: this.game})
      if (!nextAttacker.isMine || nextAttacker.armies < 2 || (nextAttacker.armies - 1 <= nextTarget.armies && !nextTarget.isMine && this.intel.attackQueue[0].priority < 10)) {
        this.intel.attackQueue = []
      }
    }

    if (this.intel.attackQueue.length < 1) {

      if (this.intel.myGeneral.idx > this.intel.myTopArmies[0].idx) {
        // follow path to most distant army to gather
      }
      const highestDarkness = Math.max(...this.intel.darknessMap)
      const highestDarknessIdx = this.intel.darknessMap.indexOf(highestDarkness)

      const nextMoveLocations = findPath({
        location: this.intel.myTopArmies[0],
        targetLocation : highestDarknessIdx,
        game: this.game,
        noCities:true
      })
      for (let i = nextMoveLocations.length - 1; i > 0; i--) {
        this.intel.attackQueue.push(makeAttackQueueObject({
          mode: "intoTheDarkness",
          attacker: nextMoveLocations[i],
          target: nextMoveLocations[i - 1],
          priority: 100
        }))
      }
    }

    // small numbers (follow),
    // larger numbers (pierce walls of larger numbers),
    // captured generals
    // discover where large number come from.


    // move largest army to closest guess.
    // choose path that gathers armies. (allowed 5 extra moves to gather)
    // choose path that discovers the most.

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
    this.intel.darknessMap = createDarknessMap(this.game)
    this.intel.myTopArmies = this.game.locations.filter((location) => location.isMine && location.armies >= USEFUL_ARMY_THRESHOLD).sort((a, b) => b.armies - a.armies)
    this.intel.myGeneral = getLocationObject({locationIdx: this.game.myGeneralLocationIndex, game: this.game})
  },

  queuePathToTarget: function (attacker, targetLocation, mode, priority, noCities) {

  },

}

export default ai
