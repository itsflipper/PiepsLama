/**
 * PerformanceMonitor.js - Queue-Performance-Tracking
 * "Das Auge das alles sieht, aber nichts berührt"
 * Passiver Telemetrie-Sammler für System-Gesundheit und Performance-Metriken
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import process from 'process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PerformanceMonitor {
  constructor(modules, logger) {
    // Module references
    this.modules = modules;
    this.logger = logger || this._createDefaultLogger();
    
    // Configuration
    this.collectionInterval = parseInt(process.env.PERF_COLLECTION_INTERVAL) || 60000; // 1 minute
    this.alertThresholds = {
      memoryUsagePercent: 0.8,
      cpuUsagePercent: 0.9,
      queueSizeWarning: 50,
      llmResponseTimeMs: 10000,
      lowSuccessRate: 0.5,
      errorRateHigh: 0.3
    };
    
    // State
    this.isRunning = false;
    this.intervalId = null;
    this.lastCollection = null;
    this.historicalData = [];
    this.maxHistorySize = 60; // Keep 1 hour of minute-by-minute data
    
    // Performance baseline
    this.baseline = {
      startTime: Date.now(),
      initialMemory: process.memoryUsage()
    };
    
    // Setup performance logger
    this.perfLogger = this._setupPerformanceLogger();
    
    this.logger.info('PerformanceMonitor initialized');
  }
  
  /**
   * Create default logger if none provided
   */
  _createDefaultLogger() {
    return winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [PerformanceMonitor] ${level}: ${message}`;
        })
      ),
      transports: [new winston.transports.Console()]
    });
  }
  
  /**
   * Setup dedicated performance logger
   */
  _setupPerformanceLogger() {
    return winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new DailyRotateFile({
          filename: join(__dirname, '..', 'Logs', 'performance-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '7d'
        })
      ]
    });
  }
  
  /**
   * Start monitoring
   */
  start() {
    if (this.isRunning) {
      this.logger.warn('PerformanceMonitor already running');
      return;
    }
    
    this.logger.info(`Starting PerformanceMonitor with ${this.collectionInterval}ms interval`);
    this.isRunning = true;
    
    // Collect initial metrics
    this.collectMetrics();
    
    // Start periodic collection
    this.intervalId = setInterval(() => {
      this.collectMetrics();
    }, this.collectionInterval);
  }
  
  /**
   * Stop monitoring
   */
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.logger.info('Stopping PerformanceMonitor');
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // Final collection
    this.collectMetrics();
  }
  
  /**
   * Main metrics collection method
   */
  collectMetrics() {
    try {
      const timestamp = new Date().toISOString();
      const metrics = this._gatherAllMetrics();
      
      // Add to history
      this._addToHistory(metrics);
      
      // Check for alerts
      const alerts = this._checkAlerts(metrics);
      metrics.alerts = alerts;
      
      // Log metrics
      this.perfLogger.info(metrics);
      
      // Log summary to console if debug enabled
      if (process.env.LOG_LEVEL === 'debug') {
        this._logSummary(metrics);
      }
      
      this.lastCollection = timestamp;
      
      return metrics;
      
    } catch (error) {
      this.logger.error(`Failed to collect metrics: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Gather all metrics from various sources
   */
  _gatherAllMetrics() {
    const timestamp = new Date().toISOString();
    
    return {
      timestamp,
      system: this._collectSystemMetrics(),
      queues: this._collectQueueMetrics(),
      llm: this._collectLLMMetrics(),
      bot: this._collectBotMetrics(),
      memory: this._collectMemoryMetrics(),
      custom: this._collectCustomMetrics()
    };
  }
  
  /**
   * Collect system-level metrics
   */
  _collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const uptime = Date.now() - this.baseline.startTime;
    
    // CPU usage calculation (rough estimate)
    const cpuUsage = process.cpuUsage();
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000 / (uptime / 1000) * 100;
    
    return {
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers
      },
      cpuUsage: Math.min(cpuPercent, 100), // Cap at 100%
      uptime,
      nodeVersion: process.version,
      platform: process.platform
    };
  }
  
  /**
   * Collect queue metrics
   */
  _collectQueueMetrics() {
    if (!this.modules.queueManager) {
      return {
        standardQueue: { size: 0, avgProcessingTime: 0, successRate: 0 },
        emergencyQueue: { size: 0, avgProcessingTime: 0, successRate: 0 },
        respawnQueue: { size: 0, avgProcessingTime: 0, successRate: 0 }
      };
    }
    
    try {
      return this.modules.queueManager.getQueueStatistics();
    } catch (error) {
      this.logger.error(`Failed to collect queue metrics: ${error.message}`);
      return {
        standardQueue: { size: 0, avgProcessingTime: 0, successRate: 0 },
        emergencyQueue: { size: 0, avgProcessingTime: 0, successRate: 0 },
        respawnQueue: { size: 0, avgProcessingTime: 0, successRate: 0 }
      };
    }
  }
  
  /**
   * Collect LLM metrics
   */
  _collectLLMMetrics() {
    if (!this.modules.ollamaInterface) {
      return {
        avgResponseTime: 0,
        requestCount: 0,
        errorRate: 0,
        contextWindowUsage: 0
      };
    }
    
    try {
      return this.modules.ollamaInterface.getMetrics();
    } catch (error) {
      this.logger.error(`Failed to collect LLM metrics: ${error.message}`);
      return {
        avgResponseTime: 0,
        requestCount: 0,
        errorRate: 0,
        contextWindowUsage: 0
      };
    }
  }
  
  /**
   * Collect bot metrics
   */
  _collectBotMetrics() {
    if (!this.modules.botStateManager || !this.modules.bot) {
      return {
        actionsPerMinute: 0,
        networkLatency: 0,
        connectionStability: 1.0,
        position: null,
        health: 20,
        food: 20
      };
    }
    
    try {
      const botState = this.modules.botStateManager.getState();
      const actionStats = this.modules.botStateManager.getActionStatistics();
      const networkMetrics = this.modules.botStateManager.getNetworkMetrics();
      
      // Calculate actions per minute
      const recentActions = actionStats.successCount + actionStats.failureCount;
      const uptimeMinutes = (Date.now() - this.baseline.startTime) / 60000;
      const actionsPerMinute = uptimeMinutes > 0 ? recentActions / uptimeMinutes : 0;
      
      // Get bot game state if available
      const bot = this.modules.bot;
      const gameState = bot && bot.entity ? {
        position: bot.entity.position,
        health: bot.health,
        food: bot.food,
        gameMode: bot.game?.gameMode,
        dimension: bot.game?.dimension
      } : null;
      
      return {
        actionsPerMinute: Math.round(actionsPerMinute * 10) / 10,
        networkLatency: networkMetrics.latency,
        connectionStability: networkMetrics.stability,
        currentState: botState,
        ...gameState
      };
    } catch (error) {
      this.logger.error(`Failed to collect bot metrics: ${error.message}`);
      return {
        actionsPerMinute: 0,
        networkLatency: 0,
        connectionStability: 1.0
      };
    }
  }
  
  /**
   * Collect memory/learning metrics
   */
  _collectMemoryMetrics() {
    if (!this.modules.learningManager) {
      return {
        totalLearnings: 0,
        learningsByType: {},
        cacheSize: 0
      };
    }
    
    try {
      const stats = this.modules.learningManager.getStatistics();
      return {
        totalLearnings: stats.totalLearnings,
        learningsByType: stats.byType,
        learningsByQueue: stats.byQueue,
        learningsByCategory: stats.byCategory
      };
    } catch (error) {
      this.logger.error(`Failed to collect memory metrics: ${error.message}`);
      return {
        totalLearnings: 0,
        learningsByType: {}
      };
    }
  }
  
  /**
   * Collect custom/additional metrics
   */
  _collectCustomMetrics() {
    const metrics = {};
    
    // Error recovery statistics
    if (this.modules.errorRecovery) {
      try {
        const errorStats = this.modules.errorRecovery.getStatistics();
        metrics.errorRecovery = {
          totalErrors: errorStats.totalErrors,
          errorsByCategory: errorStats.errorsByCategory,
          recoverySuccessRate: errorStats.successRate
        };
      } catch (error) {
        this.logger.error(`Failed to collect error recovery metrics: ${error.message}`);
      }
    }
    
    // Skill library statistics
    if (this.modules.skillLibrary) {
      try {
        metrics.skills = {
          totalSkills: this.modules.skillLibrary.getSkillCount(),
          skillsByCategory: this.modules.skillLibrary.getSkillsByCategory()
        };
      } catch (error) {
        this.logger.error(`Failed to collect skill metrics: ${error.message}`);
      }
    }
    
    return metrics;
  }
  
  /**
   * Add metrics to history
   */
  _addToHistory(metrics) {
    this.historicalData.push({
      timestamp: metrics.timestamp,
      summary: {
        memoryUsed: metrics.system.memoryUsage.heapUsed,
        cpuUsage: metrics.system.cpuUsage,
        activeQueue: metrics.bot?.currentState || 'unknown',
        totalActions: metrics.bot?.actionsPerMinute || 0,
        llmRequests: metrics.llm.requestCount
      }
    });
    
    // Maintain history size
    if (this.historicalData.length > this.maxHistorySize) {
      this.historicalData.shift();
    }
  }
  
  /**
   * Check for alert conditions
   */
  _checkAlerts(metrics) {
    const alerts = [];
    
    // Memory usage alert
    const memoryPercent = metrics.system.memoryUsage.heapUsed / metrics.system.memoryUsage.heapTotal;
    if (memoryPercent > this.alertThresholds.memoryUsagePercent) {
      alerts.push({
        level: 'warning',
        component: 'system',
        message: `High memory usage: ${Math.round(memoryPercent * 100)}%`,
        timestamp: metrics.timestamp
      });
    }
    
    // CPU usage alert
    if (metrics.system.cpuUsage > this.alertThresholds.cpuUsagePercent * 100) {
      alerts.push({
        level: 'warning',
        component: 'system',
        message: `High CPU usage: ${Math.round(metrics.system.cpuUsage)}%`,
        timestamp: metrics.timestamp
      });
    }
    
    // Queue size alerts
    Object.entries(metrics.queues).forEach(([queueName, queueMetrics]) => {
      if (queueMetrics.size > this.alertThresholds.queueSizeWarning) {
        alerts.push({
          level: 'warning',
          component: 'queue',
          message: `${queueName} has ${queueMetrics.size} pending actions`,
          timestamp: metrics.timestamp
        });
      }
      
      if (queueMetrics.successRate < this.alertThresholds.lowSuccessRate) {
        alerts.push({
          level: 'error',
          component: 'queue',
          message: `${queueName} success rate low: ${Math.round(queueMetrics.successRate * 100)}%`,
          timestamp: metrics.timestamp
        });
      }
    });
    
    // LLM performance alerts
    if (metrics.llm.avgResponseTime > this.alertThresholds.llmResponseTimeMs) {
      alerts.push({
        level: 'warning',
        component: 'llm',
        message: `LLM response time high: ${metrics.llm.avgResponseTime}ms`,
        timestamp: metrics.timestamp
      });
    }
    
    if (metrics.llm.errorRate > this.alertThresholds.errorRateHigh) {
      alerts.push({
        level: 'error',
        component: 'llm',
        message: `LLM error rate high: ${Math.round(metrics.llm.errorRate * 100)}%`,
        timestamp: metrics.timestamp
      });
    }
    
    // Bot health alerts
    if (metrics.bot.health !== undefined && metrics.bot.health < 10) {
      alerts.push({
        level: 'critical',
        component: 'bot',
        message: `Bot health critical: ${metrics.bot.health}/20`,
        timestamp: metrics.timestamp
      });
    }
    
    if (metrics.bot.food !== undefined && metrics.bot.food < 10) {
      alerts.push({
        level: 'warning',
        component: 'bot',
        message: `Bot food low: ${metrics.bot.food}/20`,
        timestamp: metrics.timestamp
      });
    }
    
    // Network stability alert
    if (metrics.bot.connectionStability < 0.5) {
      alerts.push({
        level: 'error',
        component: 'network',
        message: `Connection unstable: ${Math.round(metrics.bot.connectionStability * 100)}% stability`,
        timestamp: metrics.timestamp
      });
    }
    
    return alerts;
  }
  
  /**
   * Log summary to console
   */
  _logSummary(metrics) {
    const summary = [
      `Performance Summary (${new Date(metrics.timestamp).toLocaleTimeString()}):`,
      `- Memory: ${Math.round(metrics.system.memoryUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(metrics.system.memoryUsage.heapTotal / 1024 / 1024)}MB`,
      `- CPU: ${Math.round(metrics.system.cpuUsage)}%`,
      `- Queues: S:${metrics.queues.standardQueue.size} E:${metrics.queues.emergencyQueue.size} R:${metrics.queues.respawnQueue.size}`,
      `- LLM: ${metrics.llm.requestCount} requests, ${metrics.llm.avgResponseTime}ms avg`,
      `- Bot: ${metrics.bot.actionsPerMinute} actions/min, ${Math.round(metrics.bot.connectionStability * 100)}% stable`,
      `- Alerts: ${metrics.alerts.length}`
    ];
    
    this.logger.debug(summary.join('\n'));
  }
  
  /**
   * Get current metrics
   */
  getCurrentMetrics() {
    return this.collectMetrics();
  }
  
  /**
   * Get historical data
   */
  getHistory() {
    return this.historicalData;
  }
  
  /**
   * Get performance trends
   */
  getTrends() {
    if (this.historicalData.length < 2) {
      return null;
    }
    
    const recent = this.historicalData.slice(-10);
    const older = this.historicalData.slice(-20, -10);
    
    const recentAvg = {
      memory: recent.reduce((sum, d) => sum + d.summary.memoryUsed, 0) / recent.length,
      cpu: recent.reduce((sum, d) => sum + d.summary.cpuUsage, 0) / recent.length,
      actions: recent.reduce((sum, d) => sum + d.summary.totalActions, 0) / recent.length
    };
    
    const olderAvg = older.length > 0 ? {
      memory: older.reduce((sum, d) => sum + d.summary.memoryUsed, 0) / older.length,
      cpu: older.reduce((sum, d) => sum + d.summary.cpuUsage, 0) / older.length,
      actions: older.reduce((sum, d) => sum + d.summary.totalActions, 0) / older.length
    } : recentAvg;
    
    return {
      memoryTrend: recentAvg.memory > olderAvg.memory ? 'increasing' : 'stable',
      cpuTrend: recentAvg.cpu > olderAvg.cpu * 1.1 ? 'increasing' : 'stable',
      activityTrend: recentAvg.actions > olderAvg.actions ? 'increasing' : 'decreasing'
    };
  }
  
  /**
   * Export performance report
   */
  async exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      uptime: Date.now() - this.baseline.startTime,
      currentMetrics: this.getCurrentMetrics(),
      trends: this.getTrends(),
      history: this.historicalData,
      configuration: {
        collectionInterval: this.collectionInterval,
        alertThresholds: this.alertThresholds
      }
    };
    
    return report;
  }
}

export default PerformanceMonitor;