const express = require('express')
const cors = require('cors')
const { AgentWorkflowRunner } = require('./AgentWorkflowRunner')

const app = express()
const port = process.env.PORT || 3005

// Middleware
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Initialize workflow runner
const workflowRunner = new AgentWorkflowRunner()

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'workflow-runner' })
})

// Execute workflow
app.post('/execute', async (req, res) => {
  try {
    const { nodes, edges } = req.body
    
    if (!nodes || !edges) {
      return res.status(400).json({ 
        error: 'Missing required fields: nodes, edges' 
      })
    }

    const result = await workflowRunner.executeWorkflow(nodes, edges)
    
    res.json({
      success: true,
      result,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Workflow execution error:', error)
    res.status(500).json({ 
      error: error.message,
      success: false,
      timestamp: new Date().toISOString()
    })
  }
})

// Get available agents
app.get('/agents', (req, res) => {
  try {
    const agents = workflowRunner.getAgents()
    const agentList = Array.from(agents.keys()).map(key => ({
      key,
      name: agents.get(key).name
    }))
    
    res.json({
      success: true,
      agents: agentList
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Add new agent
app.post('/agents', async (req, res) => {
  try {
    const { key, name, instructions, tools } = req.body
    
    if (!key || !name || !instructions) {
      return res.status(400).json({ 
        error: 'Missing required fields: key, name, instructions' 
      })
    }

    // This would create a new agent - implement based on your needs
    res.json({
      success: true,
      message: 'Agent creation endpoint - implement as needed'
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.listen(port, () => {
  console.log(`Workflow service running on port ${port}`)
}) 