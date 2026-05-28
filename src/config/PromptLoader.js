import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PromptLoader {
  constructor() {
    this.prompts = null;
  }

  async load() {
    if (this.prompts) return this.prompts;

    const yamlPath = path.join(__dirname, 'prompts.yaml');
    try {
      const content = await fs.readFile(yamlPath, 'utf-8');
      this.prompts = yaml.load(content);
      return this.prompts;
    } catch (err) {
      console.error('[PromptLoader Error] Failed to load prompts.yaml:', err);
      throw err;
    }
  }

  async getPrompt(category, key) {
    const all = await this.load();
    if (!all[category]) {
      throw new Error(`Prompt category '${category}' not found in prompts.yaml`);
    }
    if (!all[category][key]) {
      throw new Error(`Prompt key '${key}' not found in prompts.yaml category '${category}'`);
    }
    return all[category][key];
  }
}

const promptLoader = new PromptLoader();
export default promptLoader;
