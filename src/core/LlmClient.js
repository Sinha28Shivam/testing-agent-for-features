import { spawn } from 'child_process';

/**
 * LlmClient wraps the local GitHub Copilot CLI.
 * It provides a clean async API to query Copilot.
 */
class LlmClient {
  /**
   * Send a prompt to the Copilot CLI.
   * @param {string} prompt - The prompt text.
   * @returns {Promise<string>} - The completion text.
   */
  async ask(prompt) {
    console.log(`[LLM] Requesting completion from GitHub Copilot CLI (Auto-Model)...`);
    
    return new Promise((resolve, reject) => {
      // Build arguments for: gh copilot -- -p "prompt" -s --model auto --excluded-tools shell,write,read
      // We use --model auto to bypass premium model rate limits, and exclude tools to prevent shell command execution attempts.
      const args = [
        'copilot', 
        '--', 
        '-p', prompt, 
        '-s', 
        '--model', 'auto', 
        '--excluded-tools', 'shell,write,read'
      ];
      
      const child = spawn('gh', args);
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          console.error(`[LLM Error] CLI exited with code ${code}. Stderr: ${stderr}`);
          reject(new Error(`Copilot CLI exit code ${code}: ${stderr}`));
        }
      });
      
      child.on('error', (err) => {
        console.error('[LLM Error] Failed to start gh process:', err);
        reject(err);
      });
    });
  }

  /**
   * Queries Copilot and attempts to parse a JSON response.
   * Prompts the model to return a code block of JSON.
   * @param {string} prompt - The prompt text.
   * @returns {Promise<object>} - Parsed JSON object.
   */
  async askJson(prompt) {
    const jsonPrompt = `${prompt}\n\nIMPORTANT: You must respond ONLY with a raw JSON object. Do not include any explanation, introductory text, markdown formatting (like \`\`\`json), or anything else. Just the raw JSON.`;
    
    let attempts = 3;
    while (attempts > 0) {
      try {
        const responseText = await this.ask(jsonPrompt);
        // Clean markdown code blocks if the model ignored instructions
        let cleanText = responseText;
        if (cleanText.includes('```')) {
          const match = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (match) {
            cleanText = match[1];
          }
        }
        
        // Remove potential leading/trailing garbage
        cleanText = cleanText.trim();
        const firstBrace = cleanText.indexOf('{');
        const lastBrace = cleanText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          cleanText = cleanText.substring(firstBrace, lastBrace + 1);
        }
        
        return JSON.parse(cleanText);
      } catch (err) {
        attempts--;
        console.warn(`[LLM] Failed to parse JSON response. Attempts left: ${attempts}. Error: ${err.message}`);
        if (attempts === 0) {
          throw new Error(`Failed to get valid JSON from Copilot: ${err.message}`);
        }
      }
    }
  }
}

const llmClient = new LlmClient();
export default llmClient;
