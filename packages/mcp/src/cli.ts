#!/usr/bin/env node
import { startStdioServer } from './server.js';

const apiKey = process.env.QUETRA_API_KEY;
const agentId = process.env.QUETRA_AGENT_ID;
const gatewayUrl = process.env.QUETRA_GATEWAY_URL;

if (!apiKey) {
  console.error('Error: QUETRA_API_KEY environment variable is required');
  process.exit(1);
}
if (!agentId) {
  console.error('Error: QUETRA_AGENT_ID environment variable is required');
  process.exit(1);
}

startStdioServer({ apiKey, agentId, gatewayUrl }).catch((error) => {
  console.error('Failed to start QuetraAI MCP server:', error);
  process.exit(1);
});
