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
import { pathfinder } from 'mineflayer-pathfinder';
import { plugin as collectBlock } from 'mineflayer-collectblock';
import { plugin as pvp } from 'mineflayer-pvp';
import armorManager from 'mineflayer-armor-manager';
import autoEat from 'mineflayer-auto-eat';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

// Module imports - KORREKT: Funktionale Module als Objekte importieren
import BotStateManager from './Queues/BotStateManager.js';
import Events from './Bot/Events.js';
import OllamaInterface from './LLM/OllamaInterface.js';
import AiResponseParser from './LLM/AiResponseParser.js';
import * as actionValidator from './LLM/ActionValidator.js';
import StandardQueue from './Queues/StandardQueue.js';
import EmergencyQueue from './Queues/EmergencyQueue.js';
import RespawnQueue from './Queues/RespawnQueue.js';
import QueueManager from './Queues/QueueManager.js';
import EventDispatcher from './Bot/EventDispatcher.js';
import LearningManager from './Memory/LearningManager.js';
import SkillLibrary from './Bot/SkillLibrary.js';
import ErrorRecovery from './Utils/ErrorRecovery.js';
import PerformanceMonitor from './Utils/PerformanceMonitor.js';
import * as botActions from './Bot/BotActions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Ensure required directories exist
function ensureDirectoriesExist() {
  const directories = [
    join(__dirname, 'Logs'),
    join(__dirname, 'Memory', 'StandardQueue'),
    join(__dirname, 'Memory', 'EmergencyQueue'),
    join(__dirname, 'Memory', 'RespawnQueue'),
    join(__dirname, 'Memory', 'SkillMemory')
  ];
  
  directories.forEach(dir => {
    mkdirSync(dir, { recursive: true });
  });
}

// Create directories before anything else
ensureDirectoriesExist();

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

// Bot configuration
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

    // Load plugins in correct order
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
        // Module instantiation with correct dependency injection
        
        // Phase 1: Core modules without dependencies
        modules.botStateManager = new BotStateManager(logger);
        modules.learningManager = new LearningManager(logger);
        
        // Phase 2: Funktionale Module (NICHT instanziieren!)
        modules.botActions = botActions;
        modules.actionValidator = actionValidator;
        
        // Phase 3: LLM modules
        modules.ollamaInterface = new OllamaInterface(
          {
            host: process.env.OLLAMA_HOST || 'http://localhost:11434',
            model: process.env.OLLAMA_MODEL || 'llama2',
            timeout: parseInt(process.env.OLLAMA_TIMEOUT) || 30000
          },
          logger
        );
        modules.aiResponseParser = new AiResponseParser(modules.actionValidator, logger);
        
        // Phase 4: Error Recovery
        modules.errorRecovery = new ErrorRecovery(logger, modules.learningManager);
        
        // Phase 5: Queue modules (korrigierte Reihenfolge der Parameter)
        modules.standardQueue = new StandardQueue(
          bot,
          modules.botStateManager,
          modules.ollamaInterface,
          modules.aiResponseParser,
          modules.botActions,
          modules.learningManager,
          logger
        );
        
        modules.emergencyQueue = new EmergencyQueue(
          bot,
          modules.botStateManager,
          modules.ollamaInterface,
          modules.aiResponseParser,
          modules.botActions,
          modules.learningManager,
          logger,
          { type: 'emergency' } // context parameter
        );
        
        modules.respawnQueue = new RespawnQueue(
          bot,
          modules.botStateManager,
          modules.ollamaInterface,
          modules.aiResponseParser,
          modules.botActions,
          modules.learningManager,
          logger,
          { type: 'respawn' } // context parameter
        );
        
        // Phase 6: Queue Manager (korrigierte Parameter)
        modules.queueManager = new QueueManager(
          bot,
          modules.botStateManager,
          modules.ollamaInterface,
          modules.aiResponseParser,
          modules.botActions,
          modules.learningManager,
          logger
        );
        
        // Set the queues in QueueManager after instantiation
        if (modules.queueManager.setQueues) {
          modules.queueManager.setQueues(
            modules.standardQueue,
            modules.emergencyQueue,
            modules.respawnQueue
          );
        }
        
        // Phase 7: Event Dispatcher
        modules.eventDispatcher = new EventDispatcher(
          modules.queueManager,
          logger
        );
        
        // Phase 8: Events (korrigierte Parameter)
        modules.events = new Events(
          bot,
          modules.eventDispatcher,
          modules.botStateManager
        );
        
        // Phase 9: Advanced modules
        modules.skillLibrary = new SkillLibrary(
          modules.botActions,
          modules.learningManager,
          logger
        );
        
        // Phase 10: Performance Monitor (needs all modules)
        modules.performanceMonitor = new PerformanceMonitor(modules, logger);
        
        logger.info('All modules initialized successfully');
        
        // Start the event dispatcher
        if (modules.eventDispatcher.startListening) {
          modules.eventDispatcher.startListening();
          logger.info('System ready - EventDispatcher active');
        }
        
        // Start performance monitoring
        if (modules.performanceMonitor.start) {
          modules.performanceMonitor.start();
          logger.info('Performance monitoring started');
        }
        
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
      if (modules.eventDispatcher && modules.eventDispatcher.stopListening) {
        modules.eventDispatcher.stopListening();
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
  
  // Clear modules
  modules = {};
  
  setTimeout(() => {
    initializeBot();
  }, delay);
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(reason = 'Unknown') {
  logger.info(`Initiating graceful shutdown: ${reason}`);
  
  try {
    // Stop performance monitoring first
    if (modules.performanceMonitor && modules.performanceMonitor.stop) {
      modules.performanceMonitor.stop();
      logger.info('Performance monitoring stopped');
    }
    
    // Notify in-game if connected
    if (bot && bot.entity) {
      bot.chat('Disconnecting...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Save current state
    if (modules.queueManager && modules.queueManager.saveState) {
      await modules.queueManager.saveState();
      logger.info('Queue state saved');
    }
    
    if (modules.learningManager && modules.learningManager.saveAll) {
      await modules.learningManager.saveAll();
      logger.info('Learnings saved');
    }
    
    // Stop all modules
    if (modules.eventDispatcher && modules.eventDispatcher.stopListening) {
      modules.eventDispatcher.stopListening();
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