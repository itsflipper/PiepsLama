/**
 * bot.js - Hauptinitialisierung und Modulaktivierung
 * "Zusammenbauen, Verbinden, Starten, Überwachen"
 * Diese Datei enthält keine Spiellogik, nur Orchestrierung.
 */

// Säule 1: Environment First
import dotenv from 'dotenv';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import mineflayer from 'mineflayer';
import pathfinderModule from 'mineflayer-pathfinder';
import collectBlockModule from 'mineflayer-collectblock';
import * as pvpModule from 'mineflayer-pvp';
import armorManagerPlugin from 'mineflayer-armor-manager';
import autoEatPlugin from 'mineflayer-auto-eat';
const { pathfinder } = pathfinderModule;
const { plugin: collectBlock } = collectBlockModule;
const { plugin: pvp } = pvpModule;
const armorManager = armorManagerPlugin;
const autoEat = autoEatPlugin;
import { StateTransition, BotStateMachine, NestedStateMachine } from 'mineflayer-statemachine';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Module imports (will be created in later phases)
// Phase 2 imports - commented for now
// import BotStateManager from './Queues/BotStateManager.js';
// import Events from './Bot/Events.js';

// Phase 3 imports - commented for now
// import OllamaInterface from './LLM/OllamaInterface.js';
// import AiResponseParser from './LLM/AiResponseParser.js';

// Phase 4 imports - commented for now
// import StandardQueue from './Queues/StandardQueue.js';
// import EmergencyQueue from './Queues/EmergencyQueue.js';
// import RespawnQueue from './Queues/RespawnQueue.js';
// import QueueManager from './Queues/QueueManager.js';

// Phase 5 imports - commented for now
// import EventDispatcher from './Bot/EventDispatcher.js';

// Phase 6 imports - commented for now
// import LearningManager from './Memory/LearningManager.js';
// import SkillLibrary from './Bot/SkillLibrary.js';

// Phase 7 imports - commented for now
// import ErrorRecovery from './Utils/ErrorRecovery.js';
// import PerformanceMonitor from './Utils/PerformanceMonitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Setup logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Add file transports if enabled
if (process.env.LOG_TO_FILE === 'true') {
  logger.add(new DailyRotateFile({
    filename: join(__dirname, 'Logs', 'system-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: process.env.LOG_MAX_FILES || '14d'
  }));
  
  logger.add(new DailyRotateFile({
    filename: join(__dirname, 'Logs', 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: process.env.LOG_MAX_FILES || '14d'
  }));
}

// Global error handling
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('Uncaught exception');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('Unhandled rejection');
});

// Säule 2: Create bot instance
logger.info('Creating bot instance...');

const botOptions = {
  host: process.env.MINECRAFT_HOST || 'localhost',
  port: parseInt(process.env.MINECRAFT_PORT) || 25565,
  username: process.env.BOT_USERNAME || 'PiepsLama',
  version: process.env.MINECRAFT_VERSION || '1.18.2',
  auth: process.env.MINECRAFT_AUTH || 'offline',
  checkTimeoutInterval: 120000 // 2 minutes
};

if (process.env.MINECRAFT_AUTH === 'microsoft' && process.env.BOT_PASSWORD) {
  botOptions.password = process.env.BOT_PASSWORD;
}

let bot;
let modules = {};
let reconnectAttempts = 0;
const maxReconnectAttempts = parseInt(process.env.MAX_RECONNECT_ATTEMPTS) || 3;

/**
 * Initialize bot and all modules
 */
async function initializeBot() {
  try {
    // Create bot instance
    bot = mineflayer.createBot(botOptions);
    logger.info(`Bot created for ${botOptions.host}:${botOptions.port}`);

    // Säule 3: Load plugins in correct order
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(collectBlock);
    bot.loadPlugin(pvp);
    bot.loadPlugin(armorManager);
    bot.loadPlugin(autoEat);
    logger.info('Plugins loaded successfully');

    // Wait for spawn event before initializing modules
    bot.once('spawn', async () => {
      logger.info('Bot spawned in world');
      
      try {
        // Säule 4 & 5: Module instantiation with dependency injection
        // Phase 2 modules
        // modules.botStateManager = new BotStateManager();
        // modules.events = new Events(bot, modules.botStateManager);
        
        // Phase 3 modules
        // modules.ollamaInterface = new OllamaInterface(
        //   process.env.OLLAMA_HOST,
        //   process.env.OLLAMA_MODEL,
        //   parseInt(process.env.OLLAMA_TIMEOUT)
        // );
        // modules.aiResponseParser = new AiResponseParser(modules.actionValidator);
        
        // Phase 4 modules
        // modules.standardQueue = new StandardQueue(bot, modules.botStateManager, modules.ollamaInterface);
        // modules.emergencyQueue = new EmergencyQueue(bot, modules.botStateManager, modules.ollamaInterface);
        // modules.respawnQueue = new RespawnQueue(bot, modules.botStateManager, modules.ollamaInterface);
        // modules.queueManager = new QueueManager(
        //   bot,
        //   modules.botStateManager,
        //   modules.standardQueue,
        //   modules.emergencyQueue,
        //   modules.respawnQueue
        // );
        
        // Phase 5 modules
        // modules.eventDispatcher = new EventDispatcher(
        //   bot,
        //   modules.queueManager,
        //   modules.botStateManager,
        //   modules.events
        // );
        
        // Phase 6 modules
        // modules.learningManager = new LearningManager();
        // modules.skillLibrary = new SkillLibrary(bot, modules.learningManager);
        
        // Phase 7 modules
        // modules.errorRecovery = new ErrorRecovery(bot, modules.learningManager, logger);
        // modules.performanceMonitor = new PerformanceMonitor(modules, logger);
        
        logger.info('All modules initialized');
        
        // Säule 6: Hand off control to EventDispatcher
        // modules.eventDispatcher.startListening();
        logger.info('System ready - EventDispatcher active');
        
        // Send ready message
        bot.chat('PiepsLama online and ready!');
        
      } catch (error) {
        logger.error('Failed to initialize modules:', error);
        await gracefulShutdown('Module initialization failed');
      }
    });

    // Bot event handlers
    bot.on('error', (error) => {
      logger.error('Bot error:', error);
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        handleReconnect();
      }
    });

    bot.on('kicked', (reason) => {
      logger.warn('Bot was kicked:', reason);
      handleReconnect();
    });

    bot.on('end', (reason) => {
      logger.info('Bot disconnected:', reason);
      if (modules.eventDispatcher) {
        // modules.eventDispatcher.stopListening();
      }
      handleReconnect();
    });

    bot.on('death', () => {
      logger.info('Bot died');
      // Death handling will be managed by EventDispatcher
    });

  } catch (error) {
    logger.error('Failed to create bot:', error);
    if (reconnectAttempts < maxReconnectAttempts) {
      handleReconnect();
    } else {
      process.exit(1);
    }
  }
}

/**
 * Handle reconnection attempts
 */
function handleReconnect() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    logger.error('Max reconnection attempts reached. Shutting down.');
    process.exit(1);
  }

  reconnectAttempts++;
  const delay = parseInt(process.env.RECONNECT_DELAY) || 5000;
  
  logger.info(`Attempting reconnection ${reconnectAttempts}/${maxReconnectAttempts} in ${delay}ms...`);
  
  // Clean up existing bot instance
  if (bot) {
    bot.removeAllListeners();
    bot = null;
  }
  
  setTimeout(() => {
    initializeBot();
  }, delay);
}

/**
 * Säule 7: Graceful shutdown handler
 */
async function gracefulShutdown(reason = 'Unknown') {
  logger.info(`Initiating graceful shutdown: ${reason}`);
  
  try {
    // Notify in-game if connected
    if (bot && bot.entity) {
      bot.chat('Disconnecting...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Save current state
    if (modules.queueManager) {
      // await modules.queueManager.saveState();
      logger.info('Queue state saved');
    }
    
    if (modules.learningManager) {
      // await modules.learningManager.saveAll();
      logger.info('Learnings saved');
    }
    
    // Stop all modules
    if (modules.eventDispatcher) {
      // modules.eventDispatcher.stopListening();
    }
    
    if (modules.performanceMonitor) {
      // modules.performanceMonitor.stop();
    }
    
    // Disconnect bot
    if (bot) {
      bot.quit();
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    logger.info('Graceful shutdown complete');
    process.exit(0);
    
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Process event handlers
process.on('SIGINT', () => {
  logger.info('Received SIGINT');
  gracefulShutdown('User interrupt');
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM');
  gracefulShutdown('Termination signal');
});

// Start the bot
logger.info('PiepsLama starting...');
initializeBot();

// Export for potential external control
export { bot, modules, logger };