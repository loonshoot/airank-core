#!/bin/bash

# Test stream service endpoint - diagnostic script

echo "🔍 Testing stream.getairank.com endpoint"
echo "========================================="
echo ""

# Test 1: DNS resolution
echo "1️⃣ Testing DNS resolution..."
nslookup stream.getairank.com
echo ""

# Test 2: TCP connection
echo "2️⃣ Testing TCP connection to port 443..."
nc -zv stream.getairank.com 443 2>&1
echo ""

# Test 3: Health endpoint
echo "3️⃣ Testing health endpoint..."
echo "URL: https://stream.getairank.com/health"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://stream.getairank.com/health)
echo "HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Health check passed"
    curl -s https://stream.getairank.com/health | jq .
else
    echo "❌ Health check failed"
    echo "Response body:"
    curl -s https://stream.getairank.com/health
fi
echo ""

# Test 4: Webhook endpoint
echo "4️⃣ Testing webhook endpoint..."
echo "URL: https://stream.getairank.com/webhooks/batch"

# Test with invalid payload (should return 400)
echo "Testing with invalid payload (should return 400)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://stream.getairank.com/webhooks/batch \
  -H "Content-Type: application/json" \
  -d '{"test":"invalid"}')
echo "HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "400" ]; then
    echo "✅ Webhook endpoint responding correctly to invalid payload"
elif [ "$HTTP_CODE" = "000" ]; then
    echo "❌ Connection failed - container may not be running"
elif [ "$HTTP_CODE" = "502" ] || [ "$HTTP_CODE" = "503" ]; then
    echo "❌ Bad Gateway / Service Unavailable - container not healthy"
elif [ "$HTTP_CODE" = "404" ]; then
    echo "❌ Not Found - routing issue or path mismatch"
else
    echo "⚠️  Unexpected status code: $HTTP_CODE"
fi
echo ""

# Test 5: Check if redirecting
echo "5️⃣ Checking for redirects..."
curl -I https://stream.getairank.com/health 2>&1 | grep -E "(HTTP|Location)"
echo ""

echo "========================================="
echo "Diagnostic complete"
echo ""
echo "Common issues:"
echo "- HTTP 000: Container not running or port not exposed"
echo "- HTTP 502/503: Container unhealthy or not ready"
echo "- HTTP 404: Domain routing misconfigured"
echo "- HTTP 200: Service working correctly! ✅"
