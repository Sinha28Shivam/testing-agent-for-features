import { spawn } from 'child_process';

/**
 * MCPBridge manages the Playwright MCP server subprocess
 * and exposes a clean async API to call browser automation tools.
 */
class MCPBridge {
  constructor() {
    this.process = null;
    this.pendingCalls = new Map(); // requestId -> {resolve, reject}
    this.messageBuffer = '';
    this.messageId = 0;
    this.tools = []; // Discovered tool list
  }

  // Start the MCP server subprocess
  async start() {
    console.log('[MCPBridge] Starting Playwright MCP server subprocess...');

    // Spawn npx @playwright/mcp
    this.process = spawn('npx', ['@playwright/mcp', '--isolated'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    this.process.stdout.on('data', (data) => {
      this.messageBuffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr.on('data', (data) => {
      console.warn(`[MCPBridge Server Stderr]: ${data.toString().trim()}`);
    });

    this.process.on('close', (code) => {
      console.log(`[MCPBridge] Subprocess closed with exit code ${code}`);
      this.process = null;
    });

    this.process.on('error', (err) => {
      console.error('[MCPBridge] Subprocess spawned error:', err);
    });

    // Wait a brief moment for the subprocess to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Initialize: discover available tools
    this.tools = await this.listTools();
    console.log(`[MCPBridge] Discovered ${this.tools.length} available tools from Playwright MCP.`);
  }

  // Buffer stdout for complete JSON-RPC messages (newline delimited)
  processBuffer() {
    let newlineIdx;
    while ((newlineIdx = this.messageBuffer.indexOf('\n')) !== -1) {
      const line = this.messageBuffer.substring(0, newlineIdx).trim();
      this.messageBuffer = this.messageBuffer.substring(newlineIdx + 1);

      if (line) {
        try {
          const message = JSON.parse(line);
          this.handleMessage(message);
        } catch (err) {
          console.error('[MCPBridge] Failed to parse JSON-RPC line:', line, err);
        }
      }
    }
  }

  // Route JSON-RPC responses back to their pending call promises
  handleMessage(message) {
    if (message.id !== undefined && this.pendingCalls.has(message.id)) {
      const { resolve, reject } = this.pendingCalls.get(message.id);
      this.pendingCalls.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
    }
  }

  // Send a JSON-RPC request to the MCP server
  sendRequest(method, params = {}) {
    if (!this.process) {
      throw new Error('MCPBridge is not running. Call start() first.');
    }

    const id = ++this.messageId;
    return new Promise((resolve, reject) => {
      this.pendingCalls.set(id, { resolve, reject });

      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      }) + '\n';

      this.process.stdin.write(message);

      // Timeout per call
      setTimeout(() => {
        if (this.pendingCalls.has(id)) {
          this.pendingCalls.delete(id);
          reject(new Error(`MCP request ${method} timed out after 30s`));
        }
      }, 30000);
    });
  }

  // Discover tools from MCP server
  async listTools() {
    const result = await this.sendRequest('tools/list', {});
    return result.tools || [];
  }

  // Call any MCP tool by name
  async callTool(toolName, args = {}) {
    return await this.sendRequest('tools/call', { name: toolName, arguments: args });
  }

  // Helper: Get accessibility snapshot of current page
  async getSnapshot() {
    const result = await this.callTool('browser_snapshot');
    if (!result.content || result.content.length === 0) {
      throw new Error('Empty response from browser_snapshot');
    }
    return result.content[0].text;
  }

  // Helper: Navigate and return snapshot
  async navigate(url) {
    await this.callTool('browser_navigate', { url });
    return await this.getSnapshot();
  }

  // Expose tool definitions in the format expected by LLM prompts
  getToolDefinitions() {
    return this.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema
    }));
  }

  async stop() {
    console.log('[MCPBridge] Stopping MCP subprocess...');

    // Close browser if open
    try {
      await this.callTool('browser_close');
    } catch (e) {
      // Ignore if browser already closed
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.pendingCalls.clear();
  }
}

export default MCPBridge;
