/**
 * ActionValidator.js - Kritische Sicherheitsschicht
 * "Vertraue niemals dem Input. Immer verifizieren."
 * Der pedantische Bürokrat, der die LLM-Ausgaben gegen die Realität prüft.
 */

import Joi from 'joi';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load available actions on startup
const availableActionsPath = join(__dirname, 'availableActions.json');
const availableActions = JSON.parse(readFileSync(availableActionsPath, 'utf8'));

// Flatten all actions into a single lookup map
const actionMap = {};
Object.values(availableActions).forEach(category => {
  Object.entries(category).forEach(([name, details]) => {
    actionMap[name] = details;
  });
});

/**
 * Main validation function - synchronous for speed
 * @param {Object} action - Action to validate { actionName, parameters }
 * @param {Object} bot - Bot instance for state/resource checks
 * @param {Object} botStateManager - Bot state manager instance
 * @returns {Object} { isValid: boolean, reason: string | null, validatedParams: object | null }
 */
export function validate(action, bot, botStateManager) {
  // Default response is "No"
  const invalidResponse = (reason) => ({
    isValid: false,
    reason: reason,
    validatedParams: null
  });

  // Gebot 2: Check if action exists in availableActions.json
  if (!action || !action.actionName) {
    return invalidResponse('No action name provided');
  }

  const actionDefinition = actionMap[action.actionName];
  if (!actionDefinition) {
    return invalidResponse(`Unknown action: ${action.actionName}`);
  }

  // Gebot 3: Validate parameters using Joi
  const paramValidation = validateParameters(action.actionName, action.parameters || {}, actionDefinition.parameters);
  if (!paramValidation.isValid) {
    return invalidResponse(paramValidation.reason);
  }

  // Gebot 4: Check resources
  const resourceCheck = checkResources(action.actionName, paramValidation.validatedParams, bot);
  if (!resourceCheck.isValid) {
    return invalidResponse(resourceCheck.reason);
  }

  // Gebot 5: Check bot state
  const stateCheck = checkBotState(action.actionName, bot, botStateManager, actionDefinition.category);
  if (!stateCheck.isValid) {
    return invalidResponse(stateCheck.reason);
  }

  // All checks passed - return valid
  return {
    isValid: true,
    reason: null,
    validatedParams: paramValidation.validatedParams
  };
}

/**
 * Validate parameters against action definition
 */
function validateParameters(actionName, providedParams, paramDefinition) {
  if (!paramDefinition) {
    return { isValid: true, validatedParams: {} };
  }

  // Build Joi schema from parameter definition
  const schemaObject = {};
  Object.entries(paramDefinition).forEach(([paramName, paramConfig]) => {
    let validator = Joi.any();

    // Set type
    switch (paramConfig.type) {
      case 'number':
        validator = Joi.number();
        break;
      case 'string':
        validator = Joi.string();
        break;
      case 'boolean':
        validator = Joi.boolean();
        break;
      case 'array':
        validator = Joi.array();
        break;
      case 'object':
        validator = Joi.object();
        break;
    }

    // Add enum constraint if present
    if (paramConfig.enum) {
      validator = validator.valid(...paramConfig.enum);
    }

    // Set required/optional with defaults
    if (paramConfig.required) {
      validator = validator.required();
    } else {
      validator = validator.optional();
      if (paramConfig.default !== undefined) {
        validator = validator.default(paramConfig.default);
      }
    }

    schemaObject[paramName] = validator;
  });

  const schema = Joi.object(schemaObject);
  const validation = schema.validate(providedParams, { 
    abortEarly: false,
    allowUnknown: false 
  });

  if (validation.error) {
    const errors = validation.error.details.map(d => d.message).join(', ');
    return {
      isValid: false,
      reason: `Parameter validation failed for ${actionName}: ${errors}`
    };
  }

  return {
    isValid: true,
    validatedParams: validation.value
  };
}

/**
 * Check if bot has required resources for the action
 */
function checkResources(actionName, params, bot) {
  // Resource checks for specific actions
  switch (actionName) {
    case 'placeBlock':
      const blockItem = bot.inventory.items().find(item => 
        item.name === params.blockName || item.displayName === params.blockName
      );
      if (!blockItem || blockItem.count < 1) {
        return {
          isValid: false,
          reason: `No ${params.blockName} in inventory to place`
        };
      }
      break;

    case 'craft':
      const mcData = bot.mcData || require('minecraft-data')(bot.version);
      const item = mcData.itemsByName[params.itemName];
      if (!item) {
        return {
          isValid: false,
          reason: `Unknown item to craft: ${params.itemName}`
        };
      }
      
      const recipe = bot.recipesFor(item.id, null, 1, params.craftingTable)[0];
      if (!recipe) {
        return {
          isValid: false,
          reason: `No recipe found for ${params.itemName}`
        };
      }

      // Check if materials are available
      const hasAllMaterials = recipe.delta.every(ingredient => {
        if (ingredient.count >= 0) return true; // Output item
        const required = Math.abs(ingredient.count) * params.count;
        const available = bot.inventory.count(ingredient.id, ingredient.metadata);
        return available >= required;
      });

      if (!hasAllMaterials) {
        return {
          isValid: false,
          reason: `Insufficient materials to craft ${params.count}x ${params.itemName}`
        };
      }
      break;

    case 'equipItem':
      const equipItem = bot.inventory.items().find(item => 
        item.name === params.itemName || item.displayName === params.itemName
      );
      if (!equipItem) {
        return {
          isValid: false,
          reason: `No ${params.itemName} in inventory to equip`
        };
      }
      break;

    case 'consumeItem':
      const consumeItem = bot.inventory.items().find(item => 
        item.name === params.itemName || item.displayName === params.itemName
      );
      if (!consumeItem) {
        return {
          isValid: false,
          reason: `No ${params.itemName} in inventory to consume`
        };
      }
      break;

    case 'tossItem':
      const tossItem = bot.inventory.items().find(item => 
        item.name === params.itemName || item.displayName === params.itemName
      );
      if (!tossItem) {
        return {
          isValid: false,
          reason: `No ${params.itemName} in inventory to toss`
        };
      }
      if (params.count > 0 && tossItem.count < params.count) {
        return {
          isValid: false,
          reason: `Not enough ${params.itemName} to toss (have ${tossItem.count}, need ${params.count})`
        };
      }
      break;

    case 'smelt':
      const inputItem = bot.inventory.items().find(item => 
        item.name === params.itemName || item.displayName === params.itemName
      );
      const fuelItem = bot.inventory.items().find(item => 
        item.name === params.fuelName || item.displayName === params.fuelName
      );
      
      if (!inputItem) {
        return {
          isValid: false,
          reason: `No ${params.itemName} in inventory to smelt`
        };
      }
      if (!fuelItem) {
        return {
          isValid: false,
          reason: `No ${params.fuelName} in inventory for fuel`
        };
      }
      if (inputItem.count < params.count) {
        return {
          isValid: false,
          reason: `Not enough ${params.itemName} to smelt (have ${inputItem.count}, need ${params.count})`
        };
      }
      break;

    case 'shoot':
      const bow = bot.inventory.items().find(item => item.name === 'bow');
      const arrows = bot.inventory.items().find(item => item.name === 'arrow');
      if (!bow) {
        return {
          isValid: false,
          reason: 'No bow in inventory to shoot'
        };
      }
      if (!arrows || arrows.count < 1) {
        return {
          isValid: false,
          reason: 'No arrows in inventory'
        };
      }
      break;

    case 'shield':
      if (params.enable) {
        const shield = bot.inventory.items().find(item => item.name === 'shield');
        if (!shield) {
          return {
            isValid: false,
            reason: 'No shield in inventory to use'
          };
        }
      }
      break;

    case 'fish':
      const fishingRod = bot.inventory.items().find(item => item.name === 'fishing_rod');
      if (!fishingRod) {
        return {
          isValid: false,
          reason: 'No fishing rod in inventory'
        };
      }
      break;

    case 'digBlock':
      // Check if bot has appropriate tool (optional but recommended)
      const blockAt = bot.blockAt(new (require('vec3'))(params.x, params.y, params.z));
      if (blockAt && blockAt.name !== 'air') {
        const toolRequired = getRequiredTool(blockAt.name);
        if (toolRequired) {
          const hasTool = bot.inventory.items().some(item => 
            item.name.includes(toolRequired)
          );
          if (!hasTool) {
            // Warning, not blocking
            console.warn(`Mining ${blockAt.name} without ${toolRequired} will be slow`);
          }
        }
      }
      break;
  }

  return { isValid: true };
}

/**
 * Check bot state compatibility
 */
function checkBotState(actionName, bot, botStateManager, actionCategory) {
  const currentState = botStateManager.getState();
  const currentQueue = botStateManager.getCurrentQueue();

  // Check if bot is busy with incompatible action
  if (currentState === 'executing') {
    const currentAction = botStateManager.getCurrentAction();
    
    // Some actions can interrupt others
    const interruptibleActions = ['stop', 'flee', 'shield'];
    if (!interruptibleActions.includes(actionName)) {
      // Check if current action is long-running
      const longRunningActions = ['collectBlock', 'goTo', 'goToEntity', 'craft', 'smelt'];
      if (currentAction && longRunningActions.includes(currentAction)) {
        return {
          isValid: false,
          reason: `Bot is busy with ${currentAction}`
        };
      }
    }
  }

  // Emergency queue restrictions
  if (currentQueue === 'emergency') {
    // Only survival/combat actions allowed during emergency
    const allowedCategories = ['survival', 'fight', 'moving'];
    const criticalActions = ['consumeItem', 'flee', 'attack', 'shield', 'goTo'];
    
    if (!allowedCategories.includes(actionCategory) && !criticalActions.includes(actionName)) {
      return {
        isValid: false,
        reason: 'Only critical actions allowed during emergency'
      };
    }
  }

  // Combat state restrictions
  if (currentState === 'combat') {
    // Restrict certain peaceful actions during combat
    const peacefulActions = ['craft', 'smelt', 'sleep', 'fish', 'trade', 'enchant'];
    if (peacefulActions.includes(actionName)) {
      return {
        isValid: false,
        reason: `Cannot ${actionName} during combat`
      };
    }
  }

  // Sleep state restrictions
  if (bot.isSleeping) {
    // Only wake action allowed while sleeping
    if (actionName !== 'wake') {
      return {
        isValid: false,
        reason: 'Bot is sleeping, must wake first'
      };
    }
  }

  // Container state checks
  const containerActions = ['depositItem', 'withdrawItem', 'windowClick', 'trade', 'enchant', 'anvilCombine', 'brew'];
  if (containerActions.includes(actionName) && !bot.currentWindow) {
    return {
      isValid: false,
      reason: `No container open for ${actionName}`
    };
  }

  // Death state check
  if (bot.health <= 0 && actionName !== 'respawn') {
    return {
      isValid: false,
      reason: 'Bot is dead, must respawn first'
    };
  }

  return { isValid: true };
}

/**
 * Helper function to determine required tool for block
 */
function getRequiredTool(blockName) {
  const toolMap = {
    stone: 'pickaxe',
    cobblestone: 'pickaxe',
    iron_ore: 'pickaxe',
    diamond_ore: 'pickaxe',
    gold_ore: 'pickaxe',
    coal_ore: 'pickaxe',
    oak_log: 'axe',
    birch_log: 'axe',
    spruce_log: 'axe',
    dirt: 'shovel',
    grass_block: 'shovel',
    sand: 'shovel',
    gravel: 'shovel'
  };
  
  return toolMap[blockName] || null;
}

/**
 * Batch validation for action queues
 * @param {Array} actions - Array of actions to validate
 * @param {Object} bot - Bot instance
 * @param {Object} botStateManager - Bot state manager
 * @returns {Array} Validation results for each action
 */
export function validateQueue(actions, bot, botStateManager) {
  return actions.map((action, index) => {
    const result = validate(action, bot, botStateManager);
    return {
      index,
      action: action.actionName,
      ...result
    };
  });
}

/**
 * Get resource requirements for an action
 * @param {String} actionName - Name of the action
 * @param {Object} params - Action parameters
 * @returns {Object} Resource requirements
 */
export function getResourceRequirements(actionName, params) {
  const requirements = {
    items: [],
    tools: [],
    blocks: [],
    other: []
  };

  switch (actionName) {
    case 'placeBlock':
      requirements.blocks.push({ name: params.blockName, count: 1 });
      break;
    case 'craft':
      requirements.other.push({ type: 'recipe', item: params.itemName });
      break;
    case 'shoot':
      requirements.tools.push({ name: 'bow', count: 1 });
      requirements.items.push({ name: 'arrow', count: 1 });
      break;
    case 'fish':
      requirements.tools.push({ name: 'fishing_rod', count: 1 });
      break;
  }

  return requirements;
}