#!/bin/bash

echo "Starting AI Rank Core services..."

# Start MongoDB if needed
docker-compose up -d mongo1

# Start workflow service
echo "Starting workflow service..."
cd workflows && npm install && npm run dev &

# Start other services as needed
echo "Services starting..."
echo "Workflow service will be available at http://localhost:3005"

# Keep script running
wait 