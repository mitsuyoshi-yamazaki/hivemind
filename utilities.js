/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('utilities');
 * mod.thing == 'a thing'; // true
 */

module.exports = {

    energyStored: function (room) {
        return 0;
    },

    getStorageLocation: function (room) {
        if (!room.memory.storage) {
            if (room.storage) {
                room.memory.storage = {
                    x: room.storage.pos.x,
                    y: room.storage.pos.y
                };
            }
            else {
                var sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
                    filter: (site) => site.structureType == STRUCTURE_STORAGE
                });
                if (sites && sites.length > 0) {
                    room.memory.storage = {
                        x: sites[0].pos.x,
                        y: sites[0].pos.y
                    };
                }
                else {
                    // Determine decent storage spot by averaging source and spawner locations.
                    var count = 1;
                    var x = room.controller.pos.x;
                    var y = room.controller.pos.y;

                    var sources = room.find(FIND_SOURCES);
                    for (var i in sources) {
                        x += sources[i].pos.x;
                        y += sources[i].pos.y;
                        count++;
                    }
                    var spawns = room.find(FIND_STRUCTURES, {
                        filter: (structure) => structure.structureType == STRUCTURE_SPAWN
                    });
                    for (var i in spawns) {
                        x += spawns[i].pos.x;
                        y += spawns[i].pos.y;
                        count++;
                    }

                    x = Math.round(x / count);
                    y = Math.round(y / count);

                    // Now that we have a base position, try to find the
                    // closest spot that is surrounded by empty tiles.
                    var dist = 0;
                    var found = false;
                    while (!found && dist < 10) {
                        for (var tx = x - dist; tx <= x + dist; tx++) {
                            for (var ty = y - dist; ty <= y + dist; ty++) {
                                if (found) {
                                    continue;
                                }

                                if (tx == x - dist || tx == x + dist || ty == y - dist || ty == y + dist) {
                                    // Tile is only valid if it and all surrounding tiles are empty.
                                    var contents = room.lookAtArea(ty - 1, tx - 1, ty + 1, tx + 1, true);
                                    var clean = true;
                                    for (var i in contents) {
                                        var tile = contents[i];
                                        if (tile.type == 'terrain' && tile.terrain != 'plain' && tile.terrain != 'swamp') {
                                            clean = false;
                                            break;
                                        }
                                        if (tile.type == 'structure' || tile.type == 'constructionSite') {
                                            clean = false;
                                            break;
                                        }
                                    }

                                    if (clean) {
                                        found = true;
                                        room.memory.storage = {
                                            x: tx,
                                            y: ty
                                        };
                                    }
                                }
                            }
                        }

                        // @todo Limit dist and find "worse" free spot otherwise.
                        dist++;
                    }
                }
            }
        }

        return room.memory.storage;
    },

    scanRoom: function (room) {
        var sources = room.find(FIND_SOURCES);

        room.memory.sources = {};

        if (sources.length > 0) {
            for (var i in sources) {
                var source = sources[i];
                var id = source.id;
                if (!room.memory.sources[id]) {
                    room.memory.sources[id] = {};
                }
                var sourceMemory = room.memory.sources[id];

                // Calculate free adjacent squares for max harvesters.
                var free = 0;
                var terrain = room.lookForAtArea(LOOK_TERRAIN, source.pos.y - 1, source.pos.x - 1, source.pos.y + 1, source.pos.x + 1, true);
                var adjacentTerrain = [];
                for (var t in terrain) {
                    var tile = terrain[t];
                    if (tile.x == source.pos.x && tile.y == source.pos.y) {
                        continue;
                    }

                    //console.log(tile.terrain, tile.x, tile.y);
                    if (tile.terrain == 'plain' || tile.terrain == 'swamp') {
                        // @todo Make sure no structures are blocking this tile.
                        free++;
                        adjacentTerrain.push(room.getPositionAt(tile.x, tile.y));
                    }
                }

                // @todo Calculate number of needed worker body parts for completely saturating this source to prevent overspawning.
                free = 1;

                sourceMemory.maxHarvesters = free;
                sourceMemory.harvesters = [];

                // Keep harvesters which are already assigned.
                var harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');
                for (var t in harvesters) {
                    var harvester = harvesters[t];
                    if (harvester.memory.fixedSource == id) {
                        sourceMemory.harvesters.push(harvester.id);
                    }
                }

                // Unassign extra harvesters.
                while (sourceMemory.harvesters.length > free) {
                    var old = sourceMemory.harvesters.pop();
                    var harvester = Game.getObjectById(old);
                    delete harvester.memory.fixedSource;
                    delete harvester.memory.fixedTarget;
                }

                // Assign free harvesters.
                for (var t in harvesters) {
                    if (sourceMemory.harvesters.length >= free) {
                        break;
                    }

                    var harvester = harvesters[t];
                    if (!harvester.memory.fixedSource) {
                        sourceMemory.harvesters.push(harvester.id);
                        harvester.memory.fixedSource = id;
                        delete harvester.memory.fixedTarget;
                    }
                }

                sourceMemory.targetContainer = null;

                // Check if there is a container nearby.
                var structures = source.pos.findInRange(FIND_STRUCTURES, 3, {
                    filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
                });
                if (structures && structures.length > 0) {
                    var structure = source.pos.findClosestByRange(structures);
                    if (structure) {
                        sourceMemory.targetContainer = structure.id;
                    }
                }

                if (!sourceMemory.dropoffSpot) {
                    // Decide on a dropoff-spot that will eventually have a container built.
                    var best;
                    var bestCount = 0;
                    var terrain = room.lookForAtArea(LOOK_TERRAIN, source.pos.y - 2, source.pos.x - 2, source.pos.y + 2, source.pos.x + 2, true);
                    for (var t in terrain) {
                        var tile = terrain[t];
                        if (source.pos.getRangeTo(tile.x, tile.y) <= 1) {
                            continue;
                        }

                        //console.log(tile.terrain, tile.x, tile.y);
                        if (tile.terrain == 'plain' || tile.terrain == 'swamp') {
                            // @todo Make sure no structures are blocking this tile.
                            var count = 0;
                            for (var u in adjacentTerrain) {
                                var aTile = adjacentTerrain[u];

                                if (aTile.getRangeTo(tile.x, tile.y) <= 1) {
                                    count++;
                                }
                            }

                            if (count > bestCount) {
                                bestCount = count;
                                best = tile;
                            }
                        }
                    }

                    if (best) {
                        sourceMemory.dropoffSpot = {x: best.x, y: best.y};
                    }
                }

                // Assign target container to available harvesters.
                if (sourceMemory.targetContainer) {
                    for (var t in sourceMemory.harvesters) {
                        var harvester = Game.getObjectById(sourceMemory.harvesters[t]);
                        harvester.memory.fixedTarget = sourceMemory.targetContainer;
                    }
                }
                if (sourceMemory.dropoffSpot) {
                    for (var t in sourceMemory.harvesters) {
                        var harvester = Game.getObjectById(sourceMemory.harvesters[t]);
                        harvester.memory.fixedDropoffSpot = sourceMemory.dropoffSpot;
                    }
                }
            }
        }
    },

    getClosest: function (creep, targets) {
        if (targets.length > 0) {
            var target = creep.pos.findClosestByPath(targets);
            if (target) {
                return target.id;
            }
        }
        return null;
    },

    getBodyCost: function (creep) {
        var cost = 0;
        for (var i in creep.body) {
            cost += BODYPART_COST[creep.body[i].type];
        }

        return cost;
    },

    generateCreepBody: function (weights, maxCost) {
        var newParts = {};
        var size = 0;
        var cost = 0;

        if (!maxCost) {
            maxCost = 300;
        }

        // Generate initial body containing at least one of each part.
        for (var part in weights) {
            newParts[part] = 1;
            size++;
            cost += BODYPART_COST[part];
        }

        if (cost > maxCost) {
            return null;
        }

        var done = false;
        while (!done) {
            done = true;
            for (var part in BODYPART_COST) {
                var currentWeight = newParts[part] / size;
                if (currentWeight <= weights[part] && cost + BODYPART_COST[part] <= maxCost) {
                    done = false;
                    newParts[part]++;
                    size++;
                    cost += BODYPART_COST[part];
                }
            }
        }

        //console.log('total cost of new body: ' + cost);

        // Chain the generated configuration into an array of body parts.
        var body = [];

        if (newParts.tough) {
            for (var i = 0; i < newParts.tough; i++) {
                body.push(TOUGH);
            }
            delete newParts.tough;
        }
        if (newParts.move) {
            // One move part will be added last.
            newParts.move--;
        }
        var done = false;
        while (!done) {
            done = true;
            for (var part in newParts) {
                if (newParts[part] > 0) {
                    body.push(part);
                    newParts[part]--;
                    done = false;
                }
            }
        }
        if (newParts.move !== undefined) {
            // Add last move part to make sure creep is always mobile.
            body.push(MOVE);
        }

        return body;
    }

};