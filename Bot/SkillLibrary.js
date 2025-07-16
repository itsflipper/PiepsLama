/**
 * SkillLibrary.js - Dynamischer, abstrahierender, sicher ausführender Skill-Generator
 * "Aus Erfolg wird Können"
 * Transformiert erfolgreiche Aktionssequenzen in wiederverwendbare Skills.
 */

import vm from 'vm';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import winston from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SkillLibrary {
  constructor(bot, learningManager) {
    this.bot = bot;
    this.learningManager = learningManager;
    
    // Skill storage
    this.skills = new Map();
    this.skillsFilePath = join(dirname(__dirname), 'Memory', 'SkillMemory', 'skills.json');
    
    // Execution tracking
    this.executionHistory = [];
    this.maxHistorySize = 100;
    
    // Setup logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [SkillLibrary] ${level}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          level: process.env.LOG_LEVEL || 'info'
        })
      ]
    });
    
    // Load existing skills on initialization
    this.loadSkills();
  }
  
  /**
   * Gebot 6: Load skills from persistent storage
   */
  async loadSkills() {
    try {
      if (existsSync(this.skillsFilePath)) {
        const data = await readFile(this.skillsFilePath, 'utf8');
        const skillsArray = JSON.parse(data);
        
        for (const skill of skillsArray) {
          this.skills.set(skill.skillId, skill);
        }
        
        this.logger.info(`Loaded ${this.skills.size} skills from storage`);
      }
    } catch (error) {
      this.logger.error(`Failed to load skills: ${error.message}`);
    }
  }
  
  /**
   * Gebot 6: Save skills to persistent storage
   */
  async saveSkills() {
    try {
      const skillsArray = Array.from(this.skills.values());
      await writeFile(this.skillsFilePath, JSON.stringify(skillsArray, null, 2), 'utf8');
      this.logger.debug(`Saved ${skillsArray.length} skills to storage`);
    } catch (error) {
      this.logger.error(`Failed to save skills: ${error.message}`);
    }
  }
  
  /**
   * Gebot 1 & 2: Add skill from successful action queue
   */
  async addSkill(actionQueue, goal, executionResults) {
    try {
      // Analyze action patterns
      const analysis = this.analyzeActionQueue(actionQueue, executionResults);
      
      // Generate skill code
      const skillCode = this.generateSkillCode(actionQueue, analysis);
      
      // Create skill metadata
      const skill = {
        skillId: uuidv4(),
        skillName: this.generateSkillName(goal, analysis),
        description: `Automated skill for: ${goal.goalDescription}`,
        category: this.determineCategory(actionQueue),
        difficulty: this.calculateDifficulty(actionQueue),
        requirements: this.extractRequirements(actionQueue),
        skillCode: {
          function: skillCode,
          parameters: analysis.parameters,
          returnType: 'Promise<boolean>'
        },
        performance: {
          averageExecutionTime: analysis.averageTime,
          successRate: 1.0, // Initial success rate
          lastExecuted: new Date().toISOString(),
          executionCount: 1
        },
        dependencies: analysis.dependencies,
        version: 1
      };
      
      // Store skill
      this.skills.set(skill.skillId, skill);
      await this.saveSkills();
      
      // Add learning about new skill
      await this.learningManager.addLearning('standard', {
        category: skill.category,
        learningType: 'actionLearning',
        content: `Created skill: ${skill.skillName}`,
        confidence: 0.9,
        context: {
          skillId: skill.skillId,
          actionCount: actionQueue.length
        }
      });
      
      this.logger.info(`Created new skill: ${skill.skillName} (${actionQueue.length} actions)`);
      
      return skill;
      
    } catch (error) {
      this.logger.error(`Failed to create skill: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Analyze action queue for patterns and parameters
   */
  analyzeActionQueue(actionQueue, executionResults) {
    const analysis = {
      totalActions: actionQueue.length,
      uniqueActions: new Set(actionQueue.map(a => a.actionName)).size,
      parameters: [],
      dependencies: [],
      averageTime: 0
    };
    
    // Extract common parameters
    const paramCounts = {};
    for (const action of actionQueue) {
      for (const [key, value] of Object.entries(action.parameters || {})) {
        if (typeof value === 'string' || typeof value === 'number') {
          const paramKey = `${action.actionName}_${key}`;
          if (!paramCounts[paramKey]) {
            paramCounts[paramKey] = { values: [], count: 0 };
          }
          paramCounts[paramKey].values.push(value);
          paramCounts[paramKey].count++;
        }
      }
    }
    
    // Identify parameters that vary (potential skill parameters)
    for (const [paramKey, data] of Object.entries(paramCounts)) {
      const uniqueValues = new Set(data.values);
      if (uniqueValues.size > 1 && data.count > 1) {
        const [actionName, paramName] = paramKey.split('_');
        analysis.parameters.push({
          name: paramName,
          type: typeof data.values[0],
          required: true,
          fromAction: actionName
        });
      }
    }
    
    // Gebot 7: Identify existing skill usage
    for (const action of actionQueue) {
      if (action.actionName.startsWith('skill_')) {
        analysis.dependencies.push(action.actionName.replace('skill_', ''));
      }
    }
    
    // Calculate average execution time
    if (executionResults && executionResults.length > 0) {
      const totalTime = executionResults.reduce((sum, r) => sum + (r.duration || 0), 0);
      analysis.averageTime = Math.round(totalTime / executionResults.length);
    }
    
    return analysis;
  }
  
  /**
   * Gebot 2: Generate executable skill code
   */
  generateSkillCode(actionQueue, analysis) {
    const lines = [
      'async function(bot, params) {',
      '  const results = [];',
      '  let success = true;',
      ''
    ];
    
    // Add each action
    for (let i = 0; i < actionQueue.length; i++) {
      const action = actionQueue[i];
      const actionVar = `action${i}`;
      
      // Build parameters object
      lines.push(`  // ${action.successCriteria || action.actionName}`);
      lines.push(`  const ${actionVar}Params = {`);
      
      for (const [key, value] of Object.entries(action.parameters || {})) {
        if (analysis.parameters.some(p => p.fromAction === action.actionName && p.name === key)) {
          lines.push(`    ${key}: params.${key} || ${JSON.stringify(value)},`);
        } else {
          lines.push(`    ${key}: ${JSON.stringify(value)},`);
        }
      }
      
      lines.push('  };');
      lines.push('');
      
      // Execute action
      lines.push('  try {');
      lines.push(`    const result = await bot.actions.${action.actionName}(bot, ${actionVar}Params);`);
      lines.push(`    results.push({ action: '${action.actionName}', success: true, result });`);
      lines.push('  } catch (error) {');
      lines.push(`    results.push({ action: '${action.actionName}', success: false, error: error.message });`);
      lines.push('    success = false;');
      
      // Add fallback if available
      if (action.fallbackAction) {
        lines.push(`    // Fallback to ${action.fallbackAction}`);
        lines.push('    try {');
        lines.push(`      await bot.actions.${action.fallbackAction}(bot, {});`);
        lines.push('    } catch (fallbackError) {');
        lines.push('      // Fallback also failed');
        lines.push('    }');
      }
      
      lines.push('  }');
      lines.push('');
      
      // Early exit on failure
      lines.push('  if (!success) return { success: false, results };');
      lines.push('');
    }
    
    lines.push('  return { success, results };');
    lines.push('}');
    
    return lines.join('\n');
  }
  
  /**
   * Gebot 3: Execute skill in sandbox
   */
  async executeSkill(skillId, parameters = {}) {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    
    this.logger.info(`Executing skill: ${skill.skillName}`);
    
    // Check requirements
    const requirementsMet = this.checkRequirements(skill.requirements);
    if (!requirementsMet.success) {
      throw new Error(`Requirements not met: ${requirementsMet.reason}`);
    }
    
    // Create sandbox context
    const sandbox = {
      bot: {
        actions: this.createSafeActions(),
        inventory: this.bot.inventory,
        entity: this.bot.entity,
        health: this.bot.health,
        food: this.bot.food
      },
      params: parameters,
      console: {
        log: (...args) => this.logger.debug(`[Skill ${skill.skillName}]`, ...args)
      },
      setTimeout: setTimeout,
      Promise: Promise
    };
    
    try {
      // Compile and run skill
      const startTime = Date.now();
      const script = new vm.Script(`(${skill.skillCode.function})(bot, params)`);
      const result = await script.runInNewContext(sandbox, {
        timeout: 60000, // 60 second timeout
        displayErrors: true
      });
      
      const executionTime = Date.now() - startTime;
      
      // Update skill performance
      skill.performance.executionCount++;
      skill.performance.lastExecuted = new Date().toISOString();
      skill.performance.averageExecutionTime = 
        (skill.performance.averageExecutionTime * (skill.performance.executionCount - 1) + executionTime) / 
        skill.performance.executionCount;
      
      if (result.success) {
        skill.performance.successRate = 
          (skill.performance.successRate * (skill.performance.executionCount - 1) + 1) / 
          skill.performance.executionCount;
      } else {
        skill.performance.successRate = 
          (skill.performance.successRate * (skill.performance.executionCount - 1)) / 
          skill.performance.executionCount;
      }
      
      // Save updated performance
      await this.saveSkills();
      
      // Record execution
      this.recordExecution(skill, result, executionTime);
      
      return result;
      
    } catch (error) {
      this.logger.error(`Skill execution failed: ${error.message}`);
      
      // Update failure rate
      skill.performance.successRate = 
        (skill.performance.successRate * (skill.performance.executionCount - 1)) / 
        skill.performance.executionCount;
      
      await this.saveSkills();
      
      throw error;
    }
  }
  
  /**
   * Create safe action proxies for sandbox
   */
  createSafeActions() {
    const safeActions = {};
    const botActions = this.bot.botActions || {};
    
    for (const [actionName, actionFunc] of Object.entries(botActions)) {
      safeActions[actionName] = async (bot, params) => {
        // Validate action exists
        if (typeof actionFunc !== 'function') {
          throw new Error(`Invalid action: ${actionName}`);
        }
        
        // Execute with real bot instance
        return await actionFunc(this.bot, params);
      };
    }
    
    // Gebot 7: Add skill execution capability
    safeActions.executeSkill = async (bot, params) => {
      if (params.skillId) {
        return await this.executeSkill(params.skillId, params.parameters);
      }
      throw new Error('No skillId provided');
    };
    
    return safeActions;
  }
  
  /**
   * Check skill requirements
   */
  checkRequirements(requirements) {
    if (!requirements) return { success: true };
    
    // Check health
    if (requirements.minHealth && this.bot.health < requirements.minHealth) {
      return { success: false, reason: `Health too low (${this.bot.health}/${requirements.minHealth})` };
    }
    
    // Check required items
    if (requirements.requiredItems) {
      for (const item of requirements.requiredItems) {
        const count = this.bot.inventory.count(
          this.bot.mcData.itemsByName[item.name]?.id
        );
        if (count < item.count) {
          return { success: false, reason: `Missing ${item.name} (${count}/${item.count})` };
        }
      }
    }
    
    // Check environment
    if (requirements.environmentConditions) {
      for (const condition of requirements.environmentConditions) {
        if (condition === 'day' && !this.bot.time.isDay) {
          return { success: false, reason: 'Must be daytime' };
        }
        if (condition === 'night' && this.bot.time.isDay) {
          return { success: false, reason: 'Must be nighttime' };
        }
      }
    }
    
    return { success: true };
  }
  
  /**
   * Gebot 5: Export skills in availableActions format
   */
  exportAsActions() {
    const skillActions = {};
    
    for (const [skillId, skill] of this.skills) {
      const actionName = `skill_${skill.skillName.toLowerCase().replace(/\s+/g, '_')}`;
      
      skillActions[actionName] = {
        description: skill.description,
        parameters: skill.skillCode.parameters.reduce((params, p) => {
          params[p.name] = {
            type: p.type,
            required: p.required
          };
          return params;
        }, {}),
        category: skill.category,
        isSkill: true,
        skillId: skillId,
        requirements: skill.requirements,
        performance: {
          successRate: skill.performance.successRate,
          averageTime: skill.performance.averageExecutionTime
        }
      };
    }
    
    return skillActions;
  }
  
  /**
   * Find applicable skills for current context
   */
  async findApplicableSkills(goal, context) {
    const applicable = [];
    
    for (const [skillId, skill] of this.skills) {
      // Check category match
      if (context.category && skill.category !== context.category) {
        continue;
      }
      
      // Check requirements
      const reqCheck = this.checkRequirements(skill.requirements);
      if (!reqCheck.success) {
        continue;
      }
      
      // Check performance threshold
      if (skill.performance.successRate < 0.5) {
        continue;
      }
      
      // Calculate relevance score
      const relevance = this.calculateRelevance(skill, goal, context);
      if (relevance > 0.3) {
        applicable.push({
          skill,
          relevance,
          successRate: skill.performance.successRate
        });
      }
    }
    
    // Sort by relevance and success rate
    return _.orderBy(applicable, ['relevance', 'successRate'], ['desc', 'desc']);
  }
  
  /**
   * Calculate skill relevance to goal
   */
  calculateRelevance(skill, goal, context) {
    let score = 0;
    
    // Category match
    if (skill.category === context.category) {
      score += 0.3;
    }
    
    // Name/description similarity
    const goalWords = goal.goalDescription.toLowerCase().split(' ');
    const skillWords = (skill.skillName + ' ' + skill.description).toLowerCase().split(' ');
    const commonWords = goalWords.filter(w => skillWords.includes(w)).length;
    score += (commonWords / goalWords.length) * 0.4;
    
    // Recent success
    const hoursSinceExecution = (Date.now() - new Date(skill.performance.lastExecuted).getTime()) / (1000 * 60 * 60);
    if (hoursSinceExecution < 24) {
      score += 0.2;
    }
    
    // High performance
    if (skill.performance.successRate > 0.8) {
      score += 0.1;
    }
    
    return Math.min(score, 1.0);
  }
  
  /**
   * Helper methods
   */
  
  generateSkillName(goal, analysis) {
    const actionTypes = [...new Set(analysis.dependencies)];
    const baseNames = {
      'moving': 'Navigation',
      'blockinteraktion': 'Building',
      'crafting': 'Crafting',
      'fight': 'Combat',
      'survival': 'Survival',
      'inventar': 'Inventory'
    };
    
    const category = this.determineCategory(actionTypes);
    const baseName = baseNames[category] || 'General';
    
    return `${baseName} Skill ${this.skills.size + 1}`;
  }
  
  determineCategory(actionQueue) {
    const categories = {
      'goTo': 'moving',
      'digBlock': 'blockinteraktion',
      'placeBlock': 'blockinteraktion',
      'craft': 'crafting',
      'attack': 'fight',
      'consumeItem': 'survival',
      'equipItem': 'inventar'
    };
    
    // Count actions by category
    const counts = {};
    for (const action of actionQueue) {
      const category = categories[action.actionName] || 'survival';
      counts[category] = (counts[category] || 0) + 1;
    }
    
    // Return most common category
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  
  calculateDifficulty(actionQueue) {
    const length = actionQueue.length;
    if (length <= 3) return 'basic';
    if (length <= 10) return 'intermediate';
    return 'advanced';
  }
  
  extractRequirements(actionQueue) {
    const requirements = {
      minHealth: 10,
      requiredItems: [],
      requiredBlocks: [],
      environmentConditions: []
    };
    
    // Analyze actions for requirements
    for (const action of actionQueue) {
      if (action.actionName === 'placeBlock') {
        const blockName = action.parameters.blockName;
        if (blockName && !requirements.requiredBlocks.includes(blockName)) {
          requirements.requiredBlocks.push(blockName);
        }
      }
      
      if (action.actionName === 'craft') {
        // Would need recipe analysis here
      }
      
      if (action.actionName === 'attack' || action.actionName === 'flee') {
        requirements.minHealth = 15;
      }
    }
    
    return requirements;
  }
  
  recordExecution(skill, result, executionTime) {
    const record = {
      skillId: skill.skillId,
      skillName: skill.skillName,
      timestamp: new Date().toISOString(),
      success: result.success,
      executionTime,
      actionCount: result.results ? result.results.length : 0
    };
    
    this.executionHistory.push(record);
    
    // Limit history size
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }
  }
  
  /**
   * Get skill statistics
   */
  getStatistics() {
    const stats = {
      totalSkills: this.skills.size,
      byCategory: {},
      byDifficulty: {},
      averageSuccessRate: 0,
      mostUsedSkills: []
    };
    
    let totalSuccessRate = 0;
    const skillUsage = [];
    
    for (const skill of this.skills.values()) {
      // By category
      stats.byCategory[skill.category] = (stats.byCategory[skill.category] || 0) + 1;
      
      // By difficulty
      stats.byDifficulty[skill.difficulty] = (stats.byDifficulty[skill.difficulty] || 0) + 1;
      
      // Success rate
      totalSuccessRate += skill.performance.successRate;
      
      // Usage
      skillUsage.push({
        name: skill.skillName,
        uses: skill.performance.executionCount,
        successRate: skill.performance.successRate
      });
    }
    
    stats.averageSuccessRate = this.skills.size > 0 ? totalSuccessRate / this.skills.size : 0;
    stats.mostUsedSkills = _.orderBy(skillUsage, ['uses'], ['desc']).slice(0, 5);
    
    return stats;
  }
}

export default SkillLibrary;