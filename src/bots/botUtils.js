const TERRAIN_EMPTY = -1    // empty or city or enemy
const TERRAIN_MTN = -2      // viewable mountain
const TERRAIN_FOG = -3     // empty or swamp or occupied
const TERRAIN_FOG_MTN = -4 // city or mnt

function findNeighbors({location, game}) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  const row = Math.floor(location.idx / game.mapWidth)
  const col = location.idx % game.mapWidth
  const neighbors = []
  if (game.intel.map[row - 1] && game.intel.map[row - 1][col]) {
    neighbors.push(makeLocationObject({locationIdx: (row - 1) * game.mapWidth + col, game}))
  }
  if (game.intel.map[row + 1] && game.intel.map[row + 1][col]) {
    neighbors.push(makeLocationObject({locationIdx: (row + 1) * game.mapWidth + col, game}))
  }
  if (game.intel.map[row] && game.intel.map[row][col - 1]) {
    neighbors.push(makeLocationObject({locationIdx: row * game.mapWidth + (col - 1), game}))
  }
  if (game.intel.map[row] && game.intel.map[row][col + 1]) {
    neighbors.push(makeLocationObject({locationIdx: row * game.mapWidth + (col + 1), game}))
  }
  return neighbors
}

function findPath({location, targetLocation, game}) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  targetLocation = typeof targetLocation == "number" ? makeLocationObject({locationIdx : targetLocation, game}) : targetLocation
  location = typeof target == "number" ? makeLocationObject({locationIdx : location, game}) : location
  // TODO avoid cities option
  let pathIndexes = []
  if (location && targetLocation) {
    const distanceMap = createDistanceMap({location, game})
    pathIndexes = findShortestPath({distanceMap, targetLocationOrPath: targetLocation, game})
    document.getElementById("log").append(`\nNew Path: + ${JSON.stringify(pathIndexes)}`)
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
  //TODO prioritize better gathering
  for (let i = 0; i < neighborLocation.length; i++) {
    if (distanceMap[neighborLocation[i].idx] < distanceMap[chosenPath.idx]) {
      chosenPath = neighborLocation[i]
    } else if (distanceMap[neighborLocation[i].idx] === distanceMap[chosenPath.idx] && getArmyAttackDiff(lastInPath, neighborLocation[i], game) > getArmyAttackDiff(lastInPath, chosenPath, game)) {
      // prioritize path that gathers the best
      chosenPath = neighborLocation[i]
    }
  }
  if (chosenPath !== lastInPath) {
    path.push(chosenPath)
    path = findShortestPath({distanceMap, targetLocationOrPath: path, game})
  }
  // create path from target
  return path
}

function createDistanceMap({location, game}) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  const distanceMap = []
  const queue = [location]
  distanceMap[location.idx] = 0
  //TODO account for cities that are fogged mountains
  while (queue.length > 0) {
    const currentLocation = queue.shift()
    const currentDistance = distanceMap[currentLocation.idx]
    if (currentDistance !== "M") {
      const neighbors = findNeighbors({location: currentLocation, game})
      for (let i = 0; i < neighbors.length; i++) {
        if (typeof distanceMap[neighbors[i].idx] === 'undefined') {
          queue.push(neighbors[i])
          if (neighbors[i].terrain === TERRAIN_FOG || neighbors[i].terrain >= TERRAIN_EMPTY) {
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

function makeLocationObject({locationIdx, game}) {
  if (!game) {
    throw new Error("This function needs game context to work")
  }
  const terrain = game.terrain[locationIdx]
  return {
    idx: locationIdx,
    armies: game.armies[locationIdx],
    terrain: terrain,
    isMine: terrain === game.playerIndex,
    isTeam: game.teams[terrain] === game.team,
    attackable: terrain === TERRAIN_EMPTY || (terrain > TERRAIN_EMPTY && terrain !== game.playerIndex && game.teams[terrain] !== game.team),
    isCity: game.knownCities.includes(locationIdx),
    isGeneral: game.opponents.some(opponent => opponent.generalLocationIndex && opponent.generalLocationIndex === locationIdx && !opponent.dead),
    distanceFromGeneral: game.intel.distanceMapFromGeneral[locationIdx]
  }
}

function makeAttackQueueObject({mode, attacker, target, sendHalf, priority}) {
  const attackerIndex = typeof attacker == "number" ? attacker : attacker.idx
  const targetIndex = typeof target == "number" ? target : target.idx
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

  findNeighbors,
  findPath,
  findShortestPath,

  // maps
  createDistanceMap,

  // object
  makeLocationObject,
  makeAttackQueueObject,

  // logic
  getArmyAttackDiff,
}