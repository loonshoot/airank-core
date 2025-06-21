const mongoose = require('mongoose')
const TriggerManager = require('./TriggerManager')

async function startListenerService() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/airank'
    await mongoose.connect(mongoUri)
    console.log('Connected to MongoDB')

    // Initialize and start trigger manager
    const triggerManager = new TriggerManager()
    await triggerManager.initialize()
    
    // Start webhook server
    const port = process.env.PORT || 3006
    triggerManager.startServer(port)
    
    console.log(`Listener service started on port ${port}`)
    
    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('Shutting down listener service...')
      await mongoose.connection.close()
      process.exit(0)
    })

    process.on('SIGINT', async () => {
      console.log('Shutting down listener service...')
      await mongoose.connection.close() 
      process.exit(0)
    })

  } catch (error) {
    console.error('Failed to start listener service:', error)
    process.exit(1)
  }
}

startListenerService() 