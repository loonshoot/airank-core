const { v4: uuidv4 } = require('uuid')
const { WorkflowRun } = require('../common/schemas/workflow')

class WorkflowQueue {
  constructor() {
    this.queue = []
    this.processing = false
    this.concurrentJobs = new Map()
    this.maxConcurrency = 5
  }

  async enqueue(workflowExecution) {
    const runId = uuidv4()
    
    // Create workflow run record
    const workflowRun = new WorkflowRun({
      id: runId,
      workflowId: workflowExecution.workflowId,
      workspaceId: workflowExecution.workspaceId,
      status: 'queued',
      triggeredBy: workflowExecution.triggeredBy,
      input: workflowExecution.triggeredBy.payload
    })
    
    await workflowRun.save()
    
    // Add to queue
    this.queue.push({
      runId,
      ...workflowExecution
    })
    
    console.log(`Workflow queued: ${runId} (queue size: ${this.queue.length})`)
    
    // Process queue
    this.processQueue()
    
    return runId
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return
    }

    if (this.concurrentJobs.size >= this.maxConcurrency) {
      return
    }

    this.processing = true

    while (this.queue.length > 0 && this.concurrentJobs.size < this.maxConcurrency) {
      const job = this.queue.shift()
      this.executeWorkflow(job)
    }

    this.processing = false
  }

  async executeWorkflow(job) {
    const { runId, workflowId, workspaceId, nodes, edges, settings, triggeredBy } = job
    
    try {
      console.log(`Starting workflow execution: ${runId}`)
      
      // Mark as running
      await WorkflowRun.findOneAndUpdate(
        { id: runId },
        { 
          status: 'running',
          startedAt: new Date()
        }
      )

      this.concurrentJobs.set(runId, job)

      // Call workflow runner service
      const result = await this.callWorkflowRunner({
        runId,
        nodes,
        edges,
        settings,
        triggeredBy
      })

      // Update run with results
      await this.completeWorkflowRun(runId, result)
      
    } catch (error) {
      console.error(`Workflow execution failed: ${runId}`, error)
      await this.failWorkflowRun(runId, error)
    } finally {
      this.concurrentJobs.delete(runId)
      // Continue processing queue
      setTimeout(() => this.processQueue(), 100)
    }
  }

  async callWorkflowRunner(execution) {
    // Call the workflow runner service
    const workflowServiceUrl = process.env.WORKFLOW_SERVICE_URL || 'http://localhost:3005'
    
    const response = await fetch(`${workflowServiceUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        runId: execution.runId,
        nodes: execution.nodes,
        edges: execution.edges,
        input: execution.triggeredBy.payload
      })
    })

    if (!response.ok) {
      throw new Error(`Workflow service error: ${response.status}`)
    }

    return await response.json()
  }

  async completeWorkflowRun(runId, result) {
    const completedAt = new Date()
    const workflowRun = await WorkflowRun.findOne({ id: runId })
    const duration = completedAt - workflowRun.startedAt

    await WorkflowRun.findOneAndUpdate(
      { id: runId },
      {
        status: 'completed',
        completedAt,
        duration,
        output: result.result,
        steps: result.steps || [],
        usage: result.usage || {}
      }
    )

    console.log(`Workflow completed: ${runId} (${duration}ms)`)
    
    // Update workflow stats
    await this.updateWorkflowStats(workflowRun.workflowId, true, duration)
  }

  async failWorkflowRun(runId, error) {
    const completedAt = new Date()
    const workflowRun = await WorkflowRun.findOne({ id: runId })
    const duration = workflowRun.startedAt ? completedAt - workflowRun.startedAt : 0

    await WorkflowRun.findOneAndUpdate(
      { id: runId },
      {
        status: 'failed',
        completedAt,
        duration,
        error: {
          message: error.message,
          stack: error.stack
        }
      }
    )

    console.log(`Workflow failed: ${runId} - ${error.message}`)
    
    // Update workflow stats
    await this.updateWorkflowStats(workflowRun.workflowId, false, duration)
  }

  async updateWorkflowStats(workflowId, success, duration) {
    const update = {
      $inc: { 
        'stats.totalRuns': 1,
        ...(success ? { 'stats.successfulRuns': 1 } : { 'stats.failedRuns': 1 })
      },
      $set: { 'stats.lastRun': new Date() }
    }

    // Calculate average execution time
    const workflow = await require('../common/schemas/workflow').Workflow.findOne({ id: workflowId })
    if (workflow && success) {
      const totalSuccessful = workflow.stats.successfulRuns + 1
      const newAvg = ((workflow.stats.avgExecutionTime * workflow.stats.successfulRuns) + duration) / totalSuccessful
      update.$set['stats.avgExecutionTime'] = Math.round(newAvg)
    }

    await require('../common/schemas/workflow').Workflow.findOneAndUpdate(
      { id: workflowId },
      update
    )
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      activeJobs: this.concurrentJobs.size,
      maxConcurrency: this.maxConcurrency
    }
  }
}

module.exports = WorkflowQueue 