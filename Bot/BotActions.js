/**
 * BotActions.js - Low-Level Mineflayer Wrapper
 * Diese Datei ist dumm und gehorsam. Sie führt nur aus, entscheidet nichts.
 * Jede Aktion ist ein Promise. Fehler sind wertvoll. Keine Verwaltungslogik.
 */

import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';

// Custom Error Classes
class ActionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

class ResourceNotFoundError extends ActionError {
  constructor(message) {
    super(message, 'RESOURCE_NOT_FOUND');
  }
}

class TargetNotFoundError extends ActionError {
  constructor(message) {
    super(message, 'TARGET_NOT_FOUND');
  }
}

class PathfindingError extends ActionError {
  constructor(message) {
    super(message, 'PATHFINDING_ERROR');
  }
}

class InvalidParameterError extends ActionError {
  constructor(message) {
    super(message, 'INVALID_PARAMETER');
  }
}

// Private Helper Functions
function _findEntityByName(bot, name, maxDistance = 32) {
  const entities = Object.values(bot.entities);
  return entities.find(entity => {
    if (!entity.name || !entity.position) return false;
    const distance = bot.entity.position.distanceTo(entity.position);
    return entity.name === name && distance <= maxDistance;
  });
}

function _findItemInInventory(bot, itemName) {
  return bot.inventory.items().find(item => 
    item.name === itemName || item.displayName === itemName
  );
}

function _findBlockByName(bot, blockName, maxDistance = 32) {
  const mcData = bot.mcData || require('minecraft-data')(bot.version);
  const blockType = mcData.blocksByName[blockName];
  if (!blockType) return null;
  
  return bot.findBlock({
    matching: blockType.id,
    maxDistance: maxDistance
  });
}

function _getBlockAt(bot, x, y, z) {
  return bot.blockAt(new Vec3(x, y, z));
}

// Movement Actions
export async function goTo(bot, params) {
  try {
    const { x, y, z, minDistance = 0 } = params;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
      throw new InvalidParameterError('Coordinates must be numbers');
    }
    
    const goal = new goals.GoalNear(x, y, z, minDistance);
    bot.pathfinder.setGoal(goal);
    
    return new Promise((resolve, reject) => {
      bot.pathfinder.once('goal_reached', () => {
        resolve({ success: true, position: { x, y, z } });
      });
      
      bot.pathfinder.once('path_update', (results) => {
        if (results.status === 'noPath') {
          reject(new PathfindingError(`No path found to coordinates: ${x}, ${y}, ${z}`));
        }
      });
      
      setTimeout(() => {
        reject(new ActionError('Movement timeout exceeded', 'TIMEOUT'));
      }, 30000);
    });
  } catch (error) {
    throw new ActionError(`Failed to navigate: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

export async function goToEntity(bot, params) {
  try {
    const { entityName, minDistance = 2 } = params;
    const entity = _findEntityByName(bot, entityName);
    
    if (!entity) {
      throw new TargetNotFoundError(`Entity '${entityName}' not found nearby`);
    }
    
    const goal = new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, minDistance);
    bot.pathfinder.setGoal(goal);
    
    return new Promise((resolve, reject) => {
      bot.pathfinder.once('goal_reached', () => {
        resolve({ success: true, entity: entity });
      });
      
      bot.pathfinder.once('path_update', (results) => {
        if (results.status === 'noPath') {
          reject(new PathfindingError(`No path found to entity: ${entityName}`));
        }
      });
      
      setTimeout(() => {
        reject(new ActionError('Movement timeout exceeded', 'TIMEOUT'));
      }, 30000);
    });
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to navigate to entity: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

export async function jump(bot, params) {
  try {
    bot.setControlState('jump', true);
    await bot.waitForTicks(1);
    bot.setControlState('jump', false);
    return { success: true };
  } catch (error) {
    throw new ActionError(`Failed to jump: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

export async function sprint(bot, params) {
  try {
    const { enable } = params;
    bot.setControlState('sprint', enable);
    return { success: true, sprinting: enable };
  } catch (error) {
    throw new ActionError(`Failed to toggle sprint: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

export async function sneak(bot, params) {
  try {
    const { enable } = params;
    bot.setControlState('sneak', enable);
    return { success: true, sneaking: enable };
  } catch (error) {
    throw new ActionError(`Failed to toggle sneak: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

export async function stop(bot, params) {
  try {
    bot.pathfinder.stop();
    bot.clearControlStates();
    return { success: true };
  } catch (error) {
    throw new ActionError(`Failed to stop: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

export async function lookAt(bot, params) {
  try {
    const { x, y, z } = params;
    await bot.lookAt(new Vec3(x, y, z));
    return { success: true, lookingAt: { x, y, z } };
  } catch (error) {
    throw new ActionError(`Failed to look at coordinates: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

export async function lookAtEntity(bot, params) {
  try {
    const { entityName } = params;
    const entity = _findEntityByName(bot, entityName);
    
    if (!entity) {
      throw new TargetNotFoundError(`Entity '${entityName}' not found`);
    }
    
    await bot.lookAt(entity.position.offset(0, entity.height, 0));
    return { success: true, entity: entity };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to look at entity: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

export async function lookAtBlock(bot, params) {
  try {
    const { x, y, z } = params;
    const blockPos = new Vec3(x, y, z);
    await bot.lookAt(blockPos.offset(0.5, 0.5, 0.5));
    return { success: true, lookingAt: { x, y, z } };
  } catch (error) {
    throw new ActionError(`Failed to look at block: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

// Block Actions
export async function digBlock(bot, params) {
  try {
    const { x, y, z } = params;
    const block = _getBlockAt(bot, x, y, z);
    
    if (!block || block.name === 'air') {
      throw new TargetNotFoundError(`No block found at ${x}, ${y}, ${z}`);
    }
    
    await bot.dig(block);
    return { success: true, block: block.name, position: { x, y, z } };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to dig block: ${error.message}`, 'BLOCK_INTERACTION_FAILED');
  }
}

export async function placeBlock(bot, params) {
  try {
    const { blockName, x, y, z, faceVector } = params;
    const item = _findItemInInventory(bot, blockName);
    
    if (!item) {
      throw new ResourceNotFoundError(`No ${blockName} in inventory to place`);
    }
    
    const referenceBlock = _getBlockAt(bot, x, y, z);
    if (!referenceBlock) {
      throw new TargetNotFoundError(`No reference block at ${x}, ${y}, ${z}`);
    }
    
    await bot.equip(item, 'hand');
    const face = faceVector || new Vec3(0, 1, 0);
    await bot.placeBlock(referenceBlock, face);
    
    return { success: true, placedBlock: blockName, position: { x, y, z } };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to place block: ${error.message}`, 'BLOCK_INTERACTION_FAILED');
  }
}

export async function activateBlock(bot, params) {
  try {
    const { x, y, z } = params;
    const block = _getBlockAt(bot, x, y, z);
    
    if (!block) {
      throw new TargetNotFoundError(`No block found at ${x}, ${y}, ${z}`);
    }
    
    await bot.activateBlock(block);
    return { success: true, activatedBlock: block.name, position: { x, y, z } };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to activate block: ${error.message}`, 'BLOCK_INTERACTION_FAILED');
  }
}

export async function collectBlock(bot, params) {
  try {
    const { blockName, count = 1 } = params;
    const mcData = bot.mcData || require('minecraft-data')(bot.version);
    const blockType = mcData.blocksByName[blockName];
    
    if (!blockType) {
      throw new InvalidParameterError(`Unknown block type: ${blockName}`);
    }
    
    const result = await bot.collectBlock.collect(blockType.id, {
      count: count,
      ignoreNoPath: false
    });
    
    return { success: true, collected: result.length, blockName: blockName };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to collect blocks: ${error.message}`, 'COLLECTION_FAILED');
  }
}

export async function findBlock(bot, params) {
  try {
    const { blockName, maxDistance = 32 } = params;
    const block = _findBlockByName(bot, blockName, maxDistance);
    
    if (!block) {
      throw new TargetNotFoundError(`Block '${blockName}' not found within ${maxDistance} blocks`);
    }
    
    return { 
      success: true, 
      block: block.name, 
      position: block.position,
      distance: bot.entity.position.distanceTo(block.position)
    };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to find block: ${error.message}`, 'SEARCH_FAILED');
  }
}

// Inventory Actions
export async function equipItem(bot, params) {
  try {
    const { itemName, destination = 'hand' } = params;
    const item = _findItemInInventory(bot, itemName);
    
    if (!item) {
      throw new ResourceNotFoundError(`No ${itemName} in inventory to equip`);
    }
    
    await bot.equip(item, destination);
    return { success: true, equipped: itemName, slot: destination };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to equip item: ${error.message}`, 'INVENTORY_FAILED');
  }
}

export async function unequip(bot, params) {
  try {
    const { destination } = params;
    await bot.unequip(destination);
    return { success: true, unequipped: destination };
  } catch (error) {
    throw new ActionError(`Failed to unequip: ${error.message}`, 'INVENTORY_FAILED');
  }
}

export async function tossItem(bot, params) {
  try {
    const { itemName, count = 1 } = params;
    const item = _findItemInInventory(bot, itemName);
    
    if (!item) {
      throw new ResourceNotFoundError(`No ${itemName} in inventory to toss`);
    }
    
    await bot.tossStack(item, count === -1 ? null : count);
    return { success: true, tossed: itemName, count: count };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to toss item: ${error.message}`, 'INVENTORY_FAILED');
  }
}

export async function openContainer(bot, params) {
  try {
    const { x, y, z } = params;
    const block = _getBlockAt(bot, x, y, z);
    
    if (!block) {
      throw new TargetNotFoundError(`No container found at ${x}, ${y}, ${z}`);
    }
    
    const window = await bot.openContainer(block);
    return { success: true, containerType: block.name, window: window };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to open container: ${error.message}`, 'CONTAINER_FAILED');
  }
}

export async function closeContainer(bot, params) {
  try {
    if (bot.currentWindow) {
      bot.closeWindow(bot.currentWindow);
    }
    return { success: true };
  } catch (error) {
    throw new ActionError(`Failed to close container: ${error.message}`, 'CONTAINER_FAILED');
  }
}

export async function depositItem(bot, params) {
  try {
    const { itemName, count = -1 } = params;
    const window = bot.currentWindow;
    
    if (!window) {
      throw new ActionError('No container open', 'NO_CONTAINER');
    }
    
    const item = _findItemInInventory(bot, itemName);
    if (!item) {
      throw new ResourceNotFoundError(`No ${itemName} in inventory to deposit`);
    }
    
    await bot.deposit(window, item.type, item.metadata, count === -1 ? item.count : count);
    return { success: true, deposited: itemName, count: count };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to deposit item: ${error.message}`, 'CONTAINER_FAILED');
  }
}

export async function withdrawItem(bot, params) {
  try {
    const { itemName, count = -1 } = params;
    const window = bot.currentWindow;
    
    if (!window) {
      throw new ActionError('No container open', 'NO_CONTAINER');
    }
    
    const mcData = bot.mcData || require('minecraft-data')(bot.version);
    const itemType = mcData.itemsByName[itemName];
    
    if (!itemType) {
      throw new InvalidParameterError(`Unknown item type: ${itemName}`);
    }
    
    await bot.withdraw(window, itemType.id, null, count);
    return { success: true, withdrawn: itemName, count: count };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to withdraw item: ${error.message}`, 'CONTAINER_FAILED');
  }
}

export async function consumeItem(bot, params) {
  try {
    const { itemName } = params;
    const item = _findItemInInventory(bot, itemName);
    
    if (!item) {
      throw new ResourceNotFoundError(`No ${itemName} in inventory to consume`);
    }
    
    await bot.equip(item, 'hand');
    await bot.consume();
    return { success: true, consumed: itemName };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to consume item: ${error.message}`, 'CONSUME_FAILED');
  }
}

export async function collectItem(bot, params) {
  try {
    const { itemName, maxDistance = 16 } = params;
    const mcData = bot.mcData || require('minecraft-data')(bot.version);
    const itemType = mcData.itemsByName[itemName];
    
    if (!itemType) {
      throw new InvalidParameterError(`Unknown item type: ${itemName}`);
    }
    
    const itemEntity = bot.nearestEntity(entity => {
      if (!entity.objectType === 'Item') return false;
      const distance = bot.entity.position.distanceTo(entity.position);
      return entity.metadata?.[10]?.itemId === itemType.id && distance <= maxDistance;
    });
    
    if (!itemEntity) {
      throw new TargetNotFoundError(`No ${itemName} items found within ${maxDistance} blocks`);
    }
    
    await goTo(bot, { 
      x: itemEntity.position.x, 
      y: itemEntity.position.y, 
      z: itemEntity.position.z,
      minDistance: 0
    });
    
    return { success: true, collected: itemName };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to collect item: ${error.message}`, 'COLLECTION_FAILED');
  }
}

export async function windowClick(bot, params) {
  try {
    const { slot, mouseButton = 0, mode = 0 } = params;
    const window = bot.currentWindow;
    
    if (!window) {
      throw new ActionError('No window open', 'NO_WINDOW');
    }
    
    await bot.clickWindow(slot, mouseButton, mode);
    return { success: true, clickedSlot: slot };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to click window: ${error.message}`, 'WINDOW_FAILED');
  }
}

// Crafting Actions
export async function craft(bot, params) {
  try {
    const { itemName, count = 1, craftingTable = false } = params;
    const mcData = bot.mcData || require('minecraft-data')(bot.version);
    const item = mcData.itemsByName[itemName];
    
    if (!item) {
      throw new InvalidParameterError(`Unknown item: ${itemName}`);
    }
    
    const recipe = bot.recipesFor(item.id, null, 1, craftingTable)[0];
    if (!recipe) {
      throw new ActionError(`No recipe found for ${itemName}`, 'NO_RECIPE');
    }
    
    await bot.craft(recipe, count, craftingTable ? bot.currentWindow : null);
    return { success: true, crafted: itemName, count: count };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to craft: ${error.message}`, 'CRAFT_FAILED');
  }
}

export async function smelt(bot, params) {
  try {
    const { itemName, fuelName, count = 1 } = params;
    
    if (!bot.currentWindow) {
      throw new ActionError('No furnace open', 'NO_FURNACE');
    }
    
    const inputItem = _findItemInInventory(bot, itemName);
    const fuelItem = _findItemInInventory(bot, fuelName);
    
    if (!inputItem) {
      throw new ResourceNotFoundError(`No ${itemName} in inventory to smelt`);
    }
    if (!fuelItem) {
      throw new ResourceNotFoundError(`No ${fuelName} in inventory for fuel`);
    }
    
    await bot.putFuelFurnace(fuelItem.type, null, Math.ceil(count / 8));
    await bot.putInputFurnace(inputItem.type, null, count);
    
    return { success: true, smelting: itemName, fuel: fuelName, count: count };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to smelt: ${error.message}`, 'SMELT_FAILED');
  }
}

export async function enchant(bot, params) {
  try {
    const { choice } = params;
    
    if (!bot.currentWindow) {
      throw new ActionError('No enchanting table open', 'NO_ENCHANT_TABLE');
    }
    
    await bot.enchant(choice);
    return { success: true, enchantmentChoice: choice };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to enchant: ${error.message}`, 'ENCHANT_FAILED');
  }
}

export async function anvilCombine(bot, params) {
  try {
    const { itemOneSlot, itemTwoSlot, newName } = params;
    
    if (!bot.currentWindow) {
      throw new ActionError('No anvil open', 'NO_ANVIL');
    }
    
    await bot.clickWindow(itemOneSlot, 0, 0);
    await bot.clickWindow(0, 0, 0); // First input slot
    await bot.clickWindow(itemTwoSlot, 0, 0);
    await bot.clickWindow(1, 0, 0); // Second input slot
    
    if (newName) {
      await bot.anvil.rename(newName);
    }
    
    await bot.clickWindow(2, 0, 0); // Output slot
    
    return { success: true, combined: true, newName: newName };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to use anvil: ${error.message}`, 'ANVIL_FAILED');
  }
}

export async function brew(bot, params) {
  try {
    const { ingredient, bottleSlots } = params;
    
    if (!bot.currentWindow) {
      throw new ActionError('No brewing stand open', 'NO_BREWING_STAND');
    }
    
    const ingredientItem = _findItemInInventory(bot, ingredient);
    if (!ingredientItem) {
      throw new ResourceNotFoundError(`No ${ingredient} in inventory for brewing`);
    }
    
    // Place ingredient
    await bot.clickWindow(ingredientItem.slot, 0, 0);
    await bot.clickWindow(3, 0, 0); // Ingredient slot
    
    // Place bottles
    for (const slot of bottleSlots) {
      await bot.clickWindow(slot, 0, 0);
    }
    
    return { success: true, brewing: ingredient, slots: bottleSlots };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to brew: ${error.message}`, 'BREW_FAILED');
  }
}

// Combat Actions
export async function attack(bot, params) {
  try {
    const { entityName } = params;
    const entity = _findEntityByName(bot, entityName);
    
    if (!entity) {
      throw new TargetNotFoundError(`Entity '${entityName}' not found`);
    }
    
    await bot.attack(entity);
    return { success: true, attacked: entityName };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to attack: ${error.message}`, 'COMBAT_FAILED');
  }
}

export async function shoot(bot, params) {
  try {
    const { entityName, chargeTime = 1000 } = params;
    const entity = _findEntityByName(bot, entityName);
    
    if (!entity) {
      throw new TargetNotFoundError(`Entity '${entityName}' not found`);
    }
    
    const bow = bot.inventory.items().find(item => item.name === 'bow');
    if (!bow) {
      throw new ResourceNotFoundError('No bow in inventory');
    }
    
    await bot.equip(bow, 'hand');
    await bot.activateItem();
    await bot.waitForTicks(Math.floor(chargeTime / 50));
    await bot.deactivateItem();
    
    return { success: true, shot: entityName, chargeTime: chargeTime };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to shoot: ${error.message}`, 'COMBAT_FAILED');
  }
}

export async function shield(bot, params) {
  try {
    const { enable } = params;
    
    if (enable) {
      const shield = bot.inventory.items().find(item => item.name === 'shield');
      if (!shield) {
        throw new ResourceNotFoundError('No shield in inventory');
      }
      await bot.equip(shield, 'off-hand');
      bot.activateItem(true);
    } else {
      bot.deactivateItem();
    }
    
    return { success: true, shielding: enable };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to use shield: ${error.message}`, 'COMBAT_FAILED');
  }
}

export async function flee(bot, params) {
  try {
    const { entityName, distance = 16 } = params;
    const entity = _findEntityByName(bot, entityName);
    
    if (!entity) {
      throw new TargetNotFoundError(`Entity '${entityName}' not found`);
    }
    
    const direction = bot.entity.position.minus(entity.position).normalize();
    const fleeTarget = bot.entity.position.plus(direction.scaled(distance));
    
    await goTo(bot, { 
      x: fleeTarget.x, 
      y: fleeTarget.y, 
      z: fleeTarget.z,
      minDistance: 0
    });
    
    return { success: true, fledFrom: entityName, distance: distance };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to flee: ${error.message}`, 'MOVEMENT_FAILED');
  }
}

// Interaction Actions
export async function chat(bot, params) {
  try {
    const { message } = params;
    await bot.chat(message);
    return { success: true, message: message };
  } catch (error) {
    throw new ActionError(`Failed to send chat: ${error.message}`, 'CHAT_FAILED');
  }
}

export async function whisper(bot, params) {
  try {
    const { username, message } = params;
    await bot.whisper(username, message);
    return { success: true, whispered: username, message: message };
  } catch (error) {
    throw new ActionError(`Failed to whisper: ${error.message}`, 'CHAT_FAILED');
  }
}

export async function sleep(bot, params) {
  try {
    const { x, y, z } = params;
    const bed = _getBlockAt(bot, x, y, z);
    
    if (!bed || !bed.name.includes('bed')) {
      throw new TargetNotFoundError(`No bed found at ${x}, ${y}, ${z}`);
    }
    
    await bot.sleep(bed);
    return { success: true, sleeping: true };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to sleep: ${error.message}`, 'INTERACTION_FAILED');
  }
}

export async function wake(bot, params) {
  try {
    await bot.wake();
    return { success: true, awake: true };
  } catch (error) {
    throw new ActionError(`Failed to wake up: ${error.message}`, 'INTERACTION_FAILED');
  }
}

export async function mount(bot, params) {
  try {
    const { entityName } = params;
    const entity = _findEntityByName(bot, entityName);
    
    if (!entity) {
      throw new TargetNotFoundError(`Entity '${entityName}' not found`);
    }
    
    await bot.mount(entity);
    return { success: true, mounted: entityName };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to mount: ${error.message}`, 'INTERACTION_FAILED');
  }
}

export async function dismount(bot, params) {
  try {
    await bot.dismount();
    return { success: true, dismounted: true };
  } catch (error) {
    throw new ActionError(`Failed to dismount: ${error.message}`, 'INTERACTION_FAILED');
  }
}

export async function fish(bot, params) {
  try {
    const rod = bot.inventory.items().find(item => item.name === 'fishing_rod');
    if (!rod) {
      throw new ResourceNotFoundError('No fishing rod in inventory');
    }
    
    await bot.equip(rod, 'hand');
    await bot.fish();
    return { success: true, fishing: true };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to fish: ${error.message}`, 'INTERACTION_FAILED');
  }
}

export async function stopFishing(bot, params) {
  try {
    bot.activateItem();
    return { success: true, stoppedFishing: true };
  } catch (error) {
    throw new ActionError(`Failed to stop fishing: ${error.message}`, 'INTERACTION_FAILED');
  }
}

export async function trade(bot, params) {
  try {
    const { tradeIndex } = params;
    
    if (!bot.currentWindow || !bot.currentWindow.type === 'minecraft:merchant') {
      throw new ActionError('No villager trade window open', 'NO_TRADE_WINDOW');
    }
    
    const trades = bot.currentWindow.trades;
    if (!trades || tradeIndex >= trades.length) {
      throw new InvalidParameterError(`Invalid trade index: ${tradeIndex}`);
    }
    
    await bot.trade(trades[tradeIndex], 1);
    return { success: true, traded: tradeIndex };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to trade: ${error.message}`, 'TRADE_FAILED');
  }
}

// Information Actions
export async function getStatus(bot, params) {
  try {
    const status = {
      health: bot.health,
      food: bot.food,
      foodSaturation: bot.foodSaturation,
      position: bot.entity.position,
      gameMode: bot.game.gameMode,
      experience: {
        level: bot.experience.level,
        points: bot.experience.points,
        progress: bot.experience.progress
      },
      isRaining: bot.isRaining,
      time: bot.time.timeOfDay,
      dimension: bot.game.dimension
    };
    
    return { success: true, status: status };
  } catch (error) {
    throw new ActionError(`Failed to get status: ${error.message}`, 'INFO_FAILED');
  }
}

export async function findEntity(bot, params) {
  try {
    const { entityType, maxDistance = 32 } = params;
    const entities = Object.values(bot.entities);
    
    const found = entities.filter(entity => {
      if (!entity.name || !entity.position) return false;
      const distance = bot.entity.position.distanceTo(entity.position);
      return entity.name === entityType && distance <= maxDistance;
    });
    
    if (found.length === 0) {
      throw new TargetNotFoundError(`No ${entityType} found within ${maxDistance} blocks`);
    }
    
    const nearest = found.reduce((nearest, entity) => {
      const distance = bot.entity.position.distanceTo(entity.position);
      const nearestDistance = bot.entity.position.distanceTo(nearest.position);
      return distance < nearestDistance ? entity : nearest;
    });
    
    return { 
      success: true, 
      entity: entityType,
      position: nearest.position,
      distance: bot.entity.position.distanceTo(nearest.position),
      count: found.length
    };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to find entity: ${error.message}`, 'SEARCH_FAILED');
  }
}

export async function getInventory(bot, params) {
  try {
    const items = bot.inventory.items().map(item => ({
      name: item.name,
      count: item.count,
      slot: item.slot,
      displayName: item.displayName
    }));
    
    return { 
      success: true, 
      inventory: items,
      emptySlots: bot.inventory.emptySlotCount()
    };
  } catch (error) {
    throw new ActionError(`Failed to get inventory: ${error.message}`, 'INFO_FAILED');
  }
}

export async function getTime(bot, params) {
  try {
    return { 
      success: true, 
      time: {
        timeOfDay: bot.time.timeOfDay,
        day: bot.time.day,
        isDay: bot.time.isDay,
        moonPhase: bot.time.moonPhase
      }
    };
  } catch (error) {
    throw new ActionError(`Failed to get time: ${error.message}`, 'INFO_FAILED');
  }
}

export async function getWeather(bot, params) {
  try {
    return { 
      success: true, 
      weather: {
        isRaining: bot.isRaining,
        rainState: bot.rainState,
        thunderState: bot.thunderState
      }
    };
  } catch (error) {
    throw new ActionError(`Failed to get weather: ${error.message}`, 'INFO_FAILED');
  }
}

export async function getOpenWindowInfo(bot, params) {
  try {
    if (!bot.currentWindow) {
      return { success: true, window: null };
    }
    
    const window = bot.currentWindow;
    const slots = window.slots.map((slot, index) => {
      if (!slot) return { index, empty: true };
      return {
        index,
        name: slot.name,
        count: slot.count,
        displayName: slot.displayName
      };
    });
    
    return { 
      success: true, 
      window: {
        type: window.type,
        title: window.title,
        slots: slots
      }
    };
  } catch (error) {
    throw new ActionError(`Failed to get window info: ${error.message}`, 'INFO_FAILED');
  }
}

export async function getTradeOptions(bot, params) {
  try {
    if (!bot.currentWindow || !bot.currentWindow.type === 'minecraft:merchant') {
      throw new ActionError('No villager trade window open', 'NO_TRADE_WINDOW');
    }
    
    const trades = bot.currentWindow.trades || [];
    const tradeOptions = trades.map((trade, index) => ({
      index,
      inputItem1: trade.inputItem1,
      inputItem2: trade.inputItem2,
      outputItem: trade.outputItem,
      disabled: trade.disabled,
      uses: trade.uses,
      maxUses: trade.maxUses
    }));
    
    return { success: true, trades: tradeOptions };
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(`Failed to get trade options: ${error.message}`, 'INFO_FAILED');
  }
}

export async function respawn(bot, params) {
  try {
    bot.respawn();
    return { success: true, respawned: true };
  } catch (error) {
    throw new ActionError(`Failed to respawn: ${error.message}`, 'RESPAWN_FAILED');
  }
}

export async function quit(bot, params) {
  try {
    const { reason = 'Disconnecting' } = params;
    bot.quit(reason);
    return { success: true, quit: true, reason: reason };
  } catch (error) {
    throw new ActionError(`Failed to quit: ${error.message}`, 'QUIT_FAILED');
  }
}
