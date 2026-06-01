import { spawn } from 'child_process';

/**
 * LlmClient wraps the local GitHub Copilot CLI and direct API.
 * It provides a clean async API to query Copilot with timeouts and retries.
 */
class LlmClient {
  /**
   * Send a prompt to the Copilot CLI or API with retries and exponential backoff.
   * @param {string} prompt - The prompt text.
   * @param {string} [model] - The optional model name.
   * @param {number} [attempt=1] - The current retry attempt.
   * @returns {Promise<string>} - The completion text.
   */
  async ask(prompt, model = null, attempt = 1) {
    const maxAttempts = 3;
    try {
      return await this._askRaw(prompt, model);
    } catch (err) {
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`[LLM] Error: ${err.message}. Retrying in ${delay}ms (Attempt ${attempt}/${maxAttempts})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await this.ask(prompt, model, attempt + 1);
      } else {
        throw err;
      }
    }
  }

  async _askRaw(prompt, model = null) {
    // Check if GITHUB_TOKEN is available to use the faster Azure GitHub Models API directly
    if (process.env.GITHUB_TOKEN) {
      console.log(`[LLM] Requesting completion from GitHub Models API (direct)...`);
      try {
        const apiUrl = process.env.AI_API_URL || 'https://models.inference.ai.azure.com';
        const chosenModel = model || process.env.AI_MODEL_STANDARD || 'gpt-4o-mini';
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(`${apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`
          },
          body: JSON.stringify({
            model: chosenModel,
            messages: [{ role: 'user', content: prompt }]
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API returned status ${response.status}: ${errText}`);
        }
        
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          return content.trim();
        }
        throw new Error('Empty response from GitHub Models API');
      } catch (err) {
        console.warn(`[LLM Warning] Direct API call failed: ${err.message}. Falling back to GitHub Copilot CLI...`);
      }
    }

    console.log(`[LLM] Requesting completion from GitHub Copilot CLI (Auto-Model)...`);
    
    return new Promise((resolve, reject) => {
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
      
      const timeoutId = setTimeout(() => {
        child.kill();
        reject(new Error('Copilot CLI execution timed out after 30s'));
      }, 30000);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          console.error(`[LLM Error] CLI exited with code ${code}. Stderr: ${stderr}`);
          reject(new Error(`Copilot CLI exit code ${code}: ${stderr}`));
        }
      });
      
      child.on('error', (err) => {
        clearTimeout(timeoutId);
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
  async askJson(prompt, model = null) {
    const jsonPrompt = `${prompt}\n\nIMPORTANT: You must respond ONLY with a raw JSON object. Do not include any explanation, introductory text, markdown formatting (like \`\`\`json), or anything else. Just the raw JSON.`;
    
    let attempts = 3;
    while (attempts > 0) {
      try {
        const responseText = await this.ask(jsonPrompt, model);
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
