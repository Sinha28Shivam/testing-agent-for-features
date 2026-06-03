import MCPBridge from './src/core/MCPBridge.js';

async function test() {
  const mcpBridge = new MCPBridge();
  await mcpBridge.start();
  const tools = mcpBridge.getToolDefinitions();
  console.log(`Number of tools: ${tools.length}`);
  
  let totalLength = 0;
  for (const t of tools) {
    const formatted = `- ${t.name}: ${t.description}`;
    console.log(`${t.name}: ${formatted.length} chars`);
    totalLength += formatted.length;
  }
  console.log(`Total tools format length: ${totalLength}`);
  await mcpBridge.stop();
  process.exit(0);
}

test().catch(console.error);
