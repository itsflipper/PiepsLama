/**
 * LearningManager.js - Intelligenter, organisierter, nachhaltiger Wissensverwalter
 * "Das Dateisystem ist das Gehirn"
 * Verwaltet alle Learnings mit Metadaten, Aging und Garbage Collection.
 */

import { readFile, writeFile, rename, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import winston from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class LearningManager {
  constructor() {
    // Memory cache for loaded learnings
    this.cache = new Map();
    this.cacheTimestamps = new Map();
    this.CACHE_DURATION = 60000; // 1 minute cache
    
    // Configuration
    this.MAX_LEARNINGS_PER_CATEGORY = parseInt(process.env.MAX_LEARNINGS_PER_CATEGORY) || 50;
    this.LEARNING_AGE_DAYS = parseInt(process.env.LEARNING_AGE_DAYS) || 7;
    this.PRUNE_PERCENTAGE = 0.1; // Remove bottom 10%
    
    // Setup logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [LearningManager] ${level}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          level: process.env.LOG_LEVEL || 'info'
        })
      ]
    });
    
    this.logger.info('LearningManager initialized');
  }
  
  /**
   * Gebot 1: Construct correct file path
   */
  _constructFilePath(queueType, category) {
    // Convert queue type to directory name
    const queueDir = queueType.charAt(0).toUpperCase() + queueType.slice(1) + 'Queue';
    const filePath = join(__dirname, queueDir, `${category}.json`);
    return filePath;
  }
  
  /**
   * Gebot 3: Atomic file read operation
   */
  async _loadLearningsFromFile(filePath) {
    // Check cache first
    const cacheKey = filePath;
    if (this.cache.has(cacheKey)) {
      const timestamp = this.cacheTimestamps.get(cacheKey);
      if (Date.now() - timestamp < this.CACHE_DURATION) {
        this.logger.debug(`Using cached learnings for ${filePath}`);
        return this.cache.get(cacheKey);
      }
    }
    
    try {
      if (!existsSync(filePath)) {
        this.logger.debug(`File ${filePath} does not exist, returning empty array`);
        return [];
      }
      
      const data = await readFile(filePath, 'utf8');
      const learnings = JSON.parse(data);
      
      // Validate structure
      if (!Array.isArray(learnings)) {
        this.logger.error(`Invalid learning file structure in ${filePath}`);
        return [];
      }
      
      // Update cache
      this.cache.set(cacheKey, learnings);
      this.cacheTimestamps.set(cacheKey, Date.now());
      
      this.logger.debug(`Loaded ${learnings.length} learnings from ${filePath}`);
      return learnings;
      
    } catch (error) {
      this.logger.error(`Failed to load learnings from ${filePath}: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Gebot 3: Atomic file write operation
   */
  async _saveLearningsToFile(filePath, learnings) {
    const tempPath = `${filePath}.tmp`;
    
    try {
      // Write to temporary file
      await writeFile(tempPath, JSON.stringify(learnings, null, 2), 'utf8');
      
      // Atomic rename
      await rename(tempPath, filePath);
      
      // Update cache
      this.cache.set(filePath, learnings);
      this.cacheTimestamps.set(filePath, Date.now());
      
      this.logger.debug(`Saved ${learnings.length} learnings to ${filePath}`);
      
    } catch (error) {
      this.logger.error(`Failed to save learnings to ${filePath}: ${error.message}`);
      
      // Clean up temp file if exists
      try {
        if (existsSync(tempPath)) {
          await unlink(tempPath);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      throw error;
    }
  }
  
  /**
   * Gebot 2: Enrich learning with metadata
   */
  _enrichLearning(learning) {
    const now = new Date().toISOString();
    
    return {
      id: uuidv4(),
      category: learning.category,
      queueType: learning.queueType || 'standard',
      learningType: learning.learningType || 'actionLearning',
      content: learning.content,
      context: learning.context || {},
      metadata: {
        createdAt: now,
        lastUsed: now,
        useCount: 0,
        confidence: learning.confidence || 0.5,
        version: 1
      },
      relatedLearnings: learning.relatedLearnings || []
    };
  }
  
  /**
   * Gebot 7: Add new learning (async)
   */
  async addLearning(queueType, learning) {
    try {
      const filePath = this._constructFilePath(queueType, learning.category);
      
      // Load existing learnings
      const learnings = await this._loadLearningsFromFile(filePath);
      
      // Enrich new learning
      const enrichedLearning = this._enrichLearning({ ...learning, queueType });
      
      // Add to array
      learnings.push(enrichedLearning);
      
      // Gebot 5: Prune if necessary
      const prunedLearnings = await this._pruneLearnings(learnings);
      
      // Save back
      await this._saveLearningsToFile(filePath, prunedLearnings);
      
      this.logger.info(`Added learning to ${queueType}/${learning.category}: ${learning.content.substring(0, 50)}...`);
      
      return enrichedLearning.id;
      
    } catch (error) {
      this.logger.error(`Failed to add learning: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Gebot 5: Prune learnings based on score
   */
  async _pruneLearnings(learnings) {
    if (learnings.length <= this.MAX_LEARNINGS_PER_CATEGORY) {
      return learnings;
    }
    
    this.logger.info(`Pruning learnings: ${learnings.length} exceeds limit of ${this.MAX_LEARNINGS_PER_CATEGORY}`);
    
    // Calculate scores
    const now = Date.now();
    const scoredLearnings = learnings.map(learning => {
      const ageInDays = (now - new Date(learning.metadata.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - (ageInDays / this.LEARNING_AGE_DAYS));
      const score = (learning.metadata.confidence * learning.metadata.useCount * recencyScore) || 0;
      
      return { learning, score };
    });
    
    // Sort by score (highest first)
    const sorted = _.orderBy(scoredLearnings, ['score'], ['desc']);
    
    // Keep top learnings
    const keepCount = Math.floor(this.MAX_LEARNINGS_PER_CATEGORY * (1 - this.PRUNE_PERCENTAGE));
    const kept = sorted.slice(0, keepCount).map(item => item.learning);
    
    this.logger.info(`Pruned ${learnings.length - kept.length} low-score learnings`);
    
    return kept;
  }
  
  /**
   * Gebot 6: Get relevant learnings with intelligent filtering
   */
  async getRelevantLearnings(queueType, category, limit = 5, filters = {}) {
    try {
      const filePath = this._constructFilePath(queueType, category);
      const learnings = await this._loadLearningsFromFile(filePath);
      
      if (learnings.length === 0) {
        return [];
      }
      
      // Apply filters
      let filtered = learnings;
      
      // Filter by learning type
      if (filters.learningType) {
        filtered = filtered.filter(l => l.learningType === filters.learningType);
      }
      
      // Filter by minimum confidence
      if (filters.minConfidence) {
        filtered = filtered.filter(l => l.metadata.confidence >= filters.minConfidence);
      }
      
      // Filter by recency
      if (filters.maxAgeHours) {
        const cutoff = Date.now() - (filters.maxAgeHours * 60 * 60 * 1000);
        filtered = filtered.filter(l => new Date(l.metadata.lastUsed).getTime() > cutoff);
      }
      
      // Sort by relevance score
      const scored = filtered.map(learning => {
        const ageInDays = (Date.now() - new Date(learning.metadata.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.max(0, 1 - (ageInDays / this.LEARNING_AGE_DAYS));
        const score = learning.metadata.confidence * (learning.metadata.useCount + 1) * recencyScore;
        
        return { learning, score };
      });
      
      // Sort and limit
      const sorted = _.orderBy(scored, ['score'], ['desc']);
      const selected = sorted.slice(0, limit).map(item => item.learning);
      
      // Update use count and last used
      for (const learning of selected) {
        learning.metadata.useCount++;
        learning.metadata.lastUsed = new Date().toISOString();
      }
      
      // Save updated learnings (don't await to avoid blocking)
      this._saveLearningsToFile(filePath, learnings).catch(error => {
        this.logger.error(`Failed to update learning usage: ${error.message}`);
      });
      
      this.logger.debug(`Retrieved ${selected.length} relevant learnings from ${queueType}/${category}`);
      
      return selected;
      
    } catch (error) {
      this.logger.error(`Failed to get relevant learnings: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Get specific learning by content/type
   */
  async getSpecificLearning(queueType, category, contentMatch) {
    try {
      const filePath = this._constructFilePath(queueType, category);
      const learnings = await this._loadLearningsFromFile(filePath);
      
      const found = learnings.find(l => 
        l.content.includes(contentMatch) || 
        (l.context && JSON.stringify(l.context).includes(contentMatch))
      );
      
      if (found) {
        // Update usage
        found.metadata.useCount++;
        found.metadata.lastUsed = new Date().toISOString();
        
        // Save updated (don't await)
        this._saveLearningsToFile(filePath, learnings).catch(error => {
          this.logger.error(`Failed to update learning usage: ${error.message}`);
        });
      }
      
      return found || null;
      
    } catch (error) {
      this.logger.error(`Failed to get specific learning: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Get top learnings by type
   */
  async getTopLearnings(learningType, limit = 3) {
    const allLearnings = [];
    const queueTypes = ['standard', 'emergency', 'respawn'];
    const categories = ['inventar', 'crafting', 'blockinteraktion', 'survival', 'fight', 'moving'];
    
    // Collect learnings from all categories
    for (const queueType of queueTypes) {
      for (const category of categories) {
        const learnings = await this.getRelevantLearnings(
          queueType, 
          category, 
          limit,
          { learningType: learningType, minConfidence: 0.7 }
        );
        allLearnings.push(...learnings);
      }
    }
    
    // Sort by confidence and return top
    const sorted = _.orderBy(allLearnings, ['metadata.confidence'], ['desc']);
    return sorted.slice(0, limit);
  }
  
  /**
   * Consolidate similar learnings
   */
  async consolidateLearnings(queueType, category) {
    try {
      const filePath = this._constructFilePath(queueType, category);
      const learnings = await this._loadLearningsFromFile(filePath);
      
      if (learnings.length < 10) {
        return; // Not worth consolidating
      }
      
      // Group by similar content (simple similarity check)
      const groups = _.groupBy(learnings, learning => {
        // Extract key words for grouping
        const words = learning.content.toLowerCase().split(' ');
        const keyWords = words.filter(w => w.length > 4).slice(0, 3).sort().join('-');
        return keyWords;
      });
      
      // Consolidate groups
      const consolidated = [];
      for (const group of Object.values(groups)) {
        if (group.length > 1) {
          // Merge similar learnings
          const merged = {
            ...group[0],
            metadata: {
              ...group[0].metadata,
              confidence: _.meanBy(group, 'metadata.confidence'),
              useCount: _.sumBy(group, 'metadata.useCount'),
              version: group[0].metadata.version + 1
            },
            relatedLearnings: _.uniq(_.flatMap(group, 'id'))
          };
          consolidated.push(merged);
        } else {
          consolidated.push(group[0]);
        }
      }
      
      if (consolidated.length < learnings.length) {
        await this._saveLearningsToFile(filePath, consolidated);
        this.logger.info(`Consolidated ${learnings.length} learnings to ${consolidated.length} in ${queueType}/${category}`);
      }
      
    } catch (error) {
      this.logger.error(`Failed to consolidate learnings: ${error.message}`);
    }
  }
  
  /**
   * Save all cached learnings (for shutdown)
   */
  async saveAll() {
    const promises = [];
    
    for (const [filePath, learnings] of this.cache.entries()) {
      promises.push(this._saveLearningsToFile(filePath, learnings));
    }
    
    await Promise.all(promises);
    this.logger.info('All cached learnings saved');
  }
  
  /**
   * Get memory statistics
   */
  async getStatistics() {
    const stats = {
      totalLearnings: 0,
      byQueue: {},
      byCategory: {},
      byType: {}
    };
    
    const queueTypes = ['standard', 'emergency', 'respawn'];
    const categories = ['inventar', 'crafting', 'blockinteraktion', 'survival', 'fight', 'moving'];
    
    for (const queueType of queueTypes) {
      stats.byQueue[queueType] = 0;
      
      for (const category of categories) {
        const filePath = this._constructFilePath(queueType, category);
        const learnings = await this._loadLearningsFromFile(filePath);
        
        stats.totalLearnings += learnings.length;
        stats.byQueue[queueType] += learnings.length;
        
        if (!stats.byCategory[category]) {
          stats.byCategory[category] = 0;
        }
        stats.byCategory[category] += learnings.length;
        
        // Count by type
        for (const learning of learnings) {
          if (!stats.byType[learning.learningType]) {
            stats.byType[learning.learningType] = 0;
          }
          stats.byType[learning.learningType]++;
        }
      }
    }
    
    return stats;
  }
  
  /**
   * Clean old learnings (maintenance task)
   */
  async cleanOldLearnings() {
    const queueTypes = ['standard', 'emergency', 'respawn'];
    const categories = ['inventar', 'crafting', 'blockinteraktion', 'survival', 'fight', 'moving'];
    let totalCleaned = 0;
    
    for (const queueType of queueTypes) {
      for (const category of categories) {
        const filePath = this._constructFilePath(queueType, category);
        const learnings = await this._loadLearningsFromFile(filePath);
        
        const cutoffDate = Date.now() - (this.LEARNING_AGE_DAYS * 24 * 60 * 60 * 1000);
        const filtered = learnings.filter(l => 
          new Date(l.metadata.lastUsed).getTime() > cutoffDate ||
          l.metadata.confidence >= 0.9 ||
          l.metadata.useCount >= 10
        );
        
        if (filtered.length < learnings.length) {
          await this._saveLearningsToFile(filePath, filtered);
          totalCleaned += learnings.length - filtered.length;
        }
      }
    }
    
    if (totalCleaned > 0) {
      this.logger.info(`Cleaned ${totalCleaned} old learnings`);
    }
  }
}

export default LearningManager;