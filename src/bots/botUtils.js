const {addGameLog} = require("../client");
const TERRAIN_EMPTY = -1    // empty or city or enemy
const TERRAIN_MTN = -2      // viewable mountain
const TERRAIN_FOG = -3     // empty or swamp or occupied
const TERRAIN_FOG_MTN = -4 // city or mnt

function findNeighbors({location, game}) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  // accept location or locationIdx
  const idx = location.idx !== undefined ? location.idx : location
  const row = Math.floor(idx / game.mapWidth)
  const col = idx % game.mapWidth
  const neighbors = []
  // Check not a map boundary and return all neighbors
  if (game.locationObjectMap[row - 1] && game.locationObjectMap[row - 1][col]) {
    neighbors.push(game.locationObjectMap[row - 1][col])
  }
  if (game.locationObjectMap[row + 1] && game.locationObjectMap[row + 1][col]) {
    neighbors.push(game.locationObjectMap[row + 1][col])
  }
  if (game.locationObjectMap[row] && game.locationObjectMap[row][col - 1]) {
    neighbors.push(game.locationObjectMap[row][col - 1])
  }
  if (game.locationObjectMap[row] && game.locationObjectMap[row][col + 1]) {
    neighbors.push(game.locationObjectMap[row][col + 1])
  }
  return neighbors
}

function findPath({location, targetLocation, game, noCities}) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  targetLocation = targetLocation.idx !== undefined ?  targetLocation : getLocationObject({locationIdx: targetLocation, game})
  location = location.idx !== undefined ? location : getLocationObject({locationIdx: location, game})
  let pathIndexes = []
  if (location && targetLocation) {
    const distanceMap = createDistanceMap({location, game, noCities})
    console.log("distanceMap: " + distanceMap)
    pathIndexes = findShortestPath({distanceMap, targetLocationOrPath: targetLocation, game})
    addGameLog(`New Path: + ${JSON.stringify(pathIndexes)}`)
  }
  return pathIndexes
}

function findShortestPath({distanceMap, targetLocationOrPath, game}) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  let path = []
  if (Array.isArray(targetLocationOrPath)) {
    path = targetLocationOrPath
  } else {
    path.push(targetLocationOrPath)
  }
  const lastInPath = path[path.length - 1]
  // Map Path Distance
  const neighborLocation = findNeighbors({location: lastInPath, game})
  let chosenPath = lastInPath
  let reachable = false
  for (let i = 0; i < neighborLocation.length; i++) {
    if(distanceMap[neighborLocation[i].idx] !== undefined
      && distanceMap[neighborLocation[i].idx] !== "C"
      && distanceMap[neighborLocation[i].idx] !== "M"
      && distanceMap[chosenPath.idx] !== undefined
      && distanceMap[chosenPath.idx] !== "C"
      && distanceMap[chosenPath.idx] !== "M") {
      reachable = true
      break
    }
  }
  if(reachable) {
    for (let i = 0; i < neighborLocation.length; i++) {
      const anotherChoice = neighborLocation[i]
      if (distanceMap[anotherChoice.idx] < distanceMap[chosenPath.idx]) {
        chosenPath = anotherChoice
      } else if (distanceMap[anotherChoice.idx] === distanceMap[chosenPath.idx]
        && getArmyAttackDiff(lastInPath, anotherChoice, game) > getArmyAttackDiff(lastInPath, chosenPath, game)) {
        chosenPath = neighborLocation[i]
      } else {
        // stay with current choice
      }
    }
  } else {
    function pathContains(location) {
      let found = false;
      for (var i = 0; i < path.length; i++) {
        if (path[i] == location) {
          found = true
          break
        }
      }
    }

    if(neighborLocation[0] && !pathContains(neighborLocation[0])) {
      chosenPath = neighborLocation[0]
    } else if(neighborLocation[1] && !pathContains(neighborLocation[1])) {
      chosenPath = neighborLocation[1]
    } else if(neighborLocation[2] && !pathContains(neighborLocation[2])) {
      chosenPath = neighborLocation[2]
    } else if(neighborLocation[3] && !pathContains(neighborLocation[3])) {
      chosenPath = neighborLocation[3]
    }
  }

  if (chosenPath !== lastInPath) {
    path.push(chosenPath)
    path = findShortestPath({distanceMap, targetLocationOrPath: path, game})
  }
  // create path from target
  console.log("shortestPath: " + JSON.stringify(path))
  return path
}

function createDistanceMap({location, game, noCities}) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  // accept location or locationIdx
  location = location.idx !== undefined ? location : getLocationObject({locationIdx: location, game})
  const distanceMap = []
  const queue = [location]
  distanceMap[location.idx] = 0
  while (queue.length > 0) {
    const currentLocation = queue.shift()
    const currentDistance = distanceMap[currentLocation.idx]
    if (currentDistance !== "M" && currentDistance !== "C") {
      const neighbors = findNeighbors({location: currentLocation, game})
      for (let i = 0; i < neighbors.length; i++) {
        if (typeof distanceMap[neighbors[i].idx] === 'undefined') {
          queue.push(neighbors[i])
          if(noCities && game.knownCities[neighbors[i].idx]) {
            distanceMap[neighbors[i].idx] = "C"
          } else if (neighbors[i].terrain === TERRAIN_FOG || neighbors[i].terrain >= TERRAIN_EMPTY || game.knownCities[neighbors[i].idx]) {
            distanceMap[neighbors[i].idx] = currentDistance + 1
          } else {
            distanceMap[neighbors[i].idx] = "M"
          }
        }
      }
    }
  }

  return distanceMap
}

function createDarknessMap(game) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }

  let darknessMap = []
  let queue = []
  const visibleTerritories = game.locations.filter((location) => location.terrain >= TERRAIN_MTN)
  for(let v = 0; v < visibleTerritories.length; v++) {
    darknessMap[visibleTerritories[v].idx] = 0
    queue.push(visibleTerritories[v])
  }
  while (queue.length > 0) {
    let currentLocation = queue.shift()
    let currentDarkness = darknessMap[currentLocation.idx]
    const neighbors = findNeighbors({location: currentLocation, game})
    for (let i = 0; i < neighbors.length; i++) {
      if (typeof darknessMap[neighbors[i].idx] === 'undefined') {
        queue.push(neighbors[i])
        darknessMap[neighbors[i].idx] = currentDarkness + 1
      }
    }
  }
  return darknessMap
}

// const row = Math.floor(idx / this.game.mapWidth)
// const col = idx % this.game.mapWidth
// const index = row * this.game.mapWidth + col
function getLocationObject({locationIdx, game}) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  return game.locationObjectMap[Math.floor(locationIdx / game.mapWidth)][locationIdx % game.mapWidth]
}

function makeAttackQueueObject({mode, attacker, target, sendHalf, priority}) {
  const attackerIndex = attacker.idx ? attacker.idx : attacker
  const targetIndex = target.idx ? target.idx : target
  return {
    mode: mode || "notSet", attackerIndex: attackerIndex, targetIndex: targetIndex, sendHalf: sendHalf || false, priority: priority || 0
  }
}

function getArmyAttackDiff(attacker, target, game) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  let diff
  // same player or same team
  if (attacker.terrain === target.terrain || game.teams[attacker.terrain] === game.teams[target.terrain]) {
    diff = attacker.armies + (target.armies - 1)
  } else {
    diff = attacker.armies - target.armies - 1
  }
  return diff
}

module.exports = {
  TERRAIN_EMPTY,    // empty or city or enemy
  TERRAIN_MTN,      // viewable mountain
  TERRAIN_FOG,      // empty or swamp or occupied
  TERRAIN_FOG_MTN,  // city or mnt

  findNeighbors, findPath, findShortestPath,

  // maps
  createDistanceMap,
  createDarknessMap,

  // object
  getLocationObject, makeAttackQueueObject,

  // logic
  getArmyAttackDiff,
}