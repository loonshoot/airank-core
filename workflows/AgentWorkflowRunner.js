const { Agent, run, tool } = require('@openai/agents')
const { z } = require('zod')

// Enhanced step types that support both AI and non-AI operations
class AgentWorkflowRunner {
  constructor() {
    this.agents = new Map()
    this.initializeDefaultAgents()
  }

  initializeDefaultAgents() {
    // Create some default agents for common tasks
    const dataAnalysisAgent = new Agent({
      name: 'Data Analysis Agent',
      instructions: 'You are a data analysis expert. Analyze the provided data and extract insights.',
      tools: [this.createDataAnalysisTool()]
    })

    const textProcessingAgent = new Agent({
      name: 'Text Processing Agent', 
      instructions: 'You are a text processing expert. Clean, format, and process text data.',
      tools: [this.createTextProcessingTool()]
    })

    const decisionAgent = new Agent({
      name: 'Decision Agent',
      instructions: 'You are a decision-making expert. Evaluate conditions and make routing decisions.',
      tools: [this.createDecisionTool()]
    })

    this.agents.set('data-analysis', dataAnalysisAgent)
    this.agents.set('text-processing', textProcessingAgent)
    this.agents.set('decision', decisionAgent)
  }

  createDataAnalysisTool() {
    return tool({
      name: 'analyze_data',
      description: 'Analyze data and extract insights',
      parameters: z.object({
        data: z.any(),
        analysisType: z.string()
      }),
      execute: async (input) => {
        // Basic data analysis logic
        return {
          summary: 'Data analysis completed',
          insights: ['Insight 1', 'Insight 2'],
          processed_data: input.data
        }
      }
    })
  }

  createTextProcessingTool() {
    return tool({
      name: 'process_text',
      description: 'Process and clean text data',
      parameters: z.object({
        text: z.string(),
        operations: z.array(z.string())
      }),
      execute: async (input) => {
        let processedText = input.text
        
        for (const operation of input.operations) {
          switch (operation) {
            case 'lowercase':
              processedText = processedText.toLowerCase()
              break
            case 'trim':
              processedText = processedText.trim()
              break
            case 'remove_special_chars':
              processedText = processedText.replace(/[^a-zA-Z0-9\s]/g, '')
              break
          }
        }
        
        return { processed_text: processedText }
      }
    })
  }

  createDecisionTool() {
    return tool({
      name: 'make_decision',
      description: 'Make a decision based on input conditions',
      parameters: z.object({
        conditions: z.any(),
        rules: z.array(z.any())
      }),
      execute: async (input) => {
        // Simple rule evaluation logic
        for (const rule of input.rules) {
          if (this.evaluateCondition(input.conditions, rule)) {
            return { decision: rule.action, confidence: 0.8 }
          }
        }
        return { decision: 'default', confidence: 0.5 }
      }
    })
  }

  evaluateCondition(conditions, rule) {
    // Basic condition evaluation - you can make this more sophisticated
    return true // Simplified for now
  }

  // Execute a workflow step (can be AI or non-AI)
  async executeStep(step, context = {}) {
    switch (step.type) {
      case 'ai-agent':
        return await this.executeAIAgent(step.agent, step.input, context)
      
      case 'webhook':
        return await this.executeWebhook(step.url, step.method, step.data, context)
      
      case 'parser':
        return await this.executeParser(step.parseType, step.config, step.input, context)
      
      case 'transformer':
        return await this.executeTransformer(step.transformFn, step.input, context)
      
      case 'condition':
        return await this.executeCondition(step.condition, step.input, context)
      
      default:
        throw new Error(`Unknown step type: ${step.type}`)
    }
  }

  async executeAIAgent(agent, input, context) {
    try {
      const result = await run(agent, JSON.stringify(input))
      return {
        type: 'ai-result',
        output: result.finalOutput,
        usage: result.usage,
        context: { ...context, ai_executed: true }
      }
    } catch (error) {
      throw new Error(`AI Agent execution failed: ${error.message}`)
    }
  }

  async executeWebhook(url, method, data, context) {
    try {
      const response = await fetch(url, {
        method: method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AI Rank-Workflow-Runner'
        },
        body: JSON.stringify(data)
      })
      
      const result = await response.json()
      return {
        type: 'webhook-result',
        output: result,
        status: response.status,
        context: { ...context, webhook_executed: true }
      }
    } catch (error) {
      throw new Error(`Webhook execution failed: ${error.message}`)
    }
  }

  async executeParser(parseType, config, input, context) {
    try {
      let parsed
      
      switch (parseType) {
        case 'json':
          parsed = typeof input === 'string' ? JSON.parse(input) : input
          break
        case 'csv':
          // Basic CSV parsing - you might want to use a proper CSV library
          const lines = input.split('\n')
          const headers = lines[0].split(',')
          parsed = lines.slice(1).map(line => {
            const values = line.split(',')
            return headers.reduce((obj, header, index) => {
              obj[header.trim()] = values[index]?.trim()
              return obj
            }, {})
          })
          break
        case 'xml':
          // Basic XML parsing - you might want to use a proper XML library
          parsed = { raw_xml: input, note: 'XML parsing not fully implemented' }
          break
        case 'text':
        default:
          parsed = { text: input.toString() }
      }
      
      return {
        type: 'parser-result',
        output: parsed,
        parseType,
        context: { ...context, parsed: true }
      }
    } catch (error) {
      throw new Error(`Parser execution failed: ${error.message}`)
    }
  }

  async executeTransformer(transformFn, input, context) {
    try {
      const result = transformFn(input)
      return {
        type: 'transformer-result',
        output: result,
        context: { ...context, transformed: true }
      }
    } catch (error) {
      throw new Error(`Transformer execution failed: ${error.message}`)
    }
  }

  async executeCondition(condition, input, context) {
    try {
      const result = condition(input)
      return {
        type: 'condition-result',
        output: result,
        decision: result ? 'true_path' : 'false_path',
        context: { ...context, condition_evaluated: true }
      }
    } catch (error) {
      throw new Error(`Condition execution failed: ${error.message}`)
    }
  }

  convertNodesToWorkflow(nodes, edges) {
    // Find trigger nodes (starting points)
    const triggerNodes = nodes.filter(node => node.type === 'trigger')
    
    if (triggerNodes.length === 0) {
      throw new Error('No trigger node found in workflow')
    }

    const buildSteps = (nodeId, input = null) => {
      const node = nodes.find(n => n.id === nodeId)
      if (!node) return []

      const step = this.nodeToStep(node, input)
      if (!step) return []

      // Find connected nodes
      const outgoingEdges = edges.filter(e => e.source === nodeId)
      const steps = [step]

      for (const edge of outgoingEdges) {
        const childSteps = buildSteps(edge.target, step.input)
        steps.push(...childSteps)
      }

      return steps
    }

    // Convert from first trigger node
    return buildSteps(triggerNodes[0].id)
  }

  nodeToStep(node, input) {
    switch (node.type) {
      case 'ai-agent':
        const agentKey = node.data.config?.agent || 'data-analysis'
        const agent = this.agents.get(agentKey)
        if (!agent) {
          throw new Error(`Agent not found: ${agentKey}`)
        }
        return {
          type: 'ai-agent',
          agent,
          input: input || node.data.config?.input || {}
        }

      case 'webhook':
        return {
          type: 'webhook',
          url: node.data.webhook_url || node.data.config?.url,
          method: node.data.config?.method || 'POST',
          data: input || node.data.config?.data || {}
        }

      case 'parser':
        return {
          type: 'parser',
          parseType: node.data.parse_type || 'json',
          config: node.data.parse_config || {},
          input: input || node.data.config?.input || {}
        }

      case 'transformer':
        // For now, just return the input - in practice you'd define transformation logic
        return {
          type: 'transformer',
          transformFn: (data) => data, // Default passthrough
          input: input || node.data.config?.input || {}
        }

      case 'ifthenor':
        return {
          type: 'condition',
          condition: (data) => {
            // Basic condition evaluation
            const { field, operator, value } = node.data.config || {}
            if (!field || !operator) return true
            
            switch (operator) {
              case 'equals': return data[field] === value
              case 'not_equals': return data[field] !== value
              case 'greater_than': return data[field] > value
              case 'less_than': return data[field] < value
              default: return true
            }
          },
          input: input || node.data.config?.input || {}
        }

      case 'trigger':
      case 'destination':
        // These are workflow control nodes, not execution steps
        return null

      default:
        console.warn(`Unknown node type: ${node.type}`)
        return null
    }
  }

  async executeWorkflow(nodes, edges) {
    try {
      console.log(`Starting workflow execution with ${nodes.length} nodes and ${edges.length} edges`)
      
      // Find trigger node
      const triggerNode = nodes.find(node => node.type === 'trigger')
      if (!triggerNode) {
        throw new Error('No trigger node found')
      }

      // Get initial data from trigger
      const initialData = triggerNode.data.config?.initialData || {}
      
      // Execute workflow starting from trigger
      const results = await this.executeFromNode(triggerNode.id, nodes, edges, initialData)
      
      return {
        success: true,
        results,
        nodesExecuted: results.length,
        totalNodes: nodes.length
      }
    } catch (error) {
      throw new Error(`Workflow execution failed: ${error.message}`)
    }
  }

  async executeFromNode(nodeId, nodes, edges, data) {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return []

    const results = []
    
    // Skip trigger nodes in execution
    if (node.type !== 'trigger') {
      const step = this.nodeToStep(node, data)
      if (step) {
        const result = await this.executeStep(step)
        results.push({
          nodeId: node.id,
          nodeType: node.type,
          result
        })
        data = result.output || data
      }
    }

    // Find and execute next nodes
    const outgoingEdges = edges.filter(e => e.source === nodeId)
    for (const edge of outgoingEdges) {
      const childResults = await this.executeFromNode(edge.target, nodes, edges, data)
      results.push(...childResults)
    }

    return results
  }

  addAgent(key, agent) {
    this.agents.set(key, agent)
  }

  getAgents() {
    return this.agents
  }
}

module.exports = { AgentWorkflowRunner } 