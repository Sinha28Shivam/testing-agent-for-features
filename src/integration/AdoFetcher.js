import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import dotenv from 'dotenv';
import AdoClient from './AdoClient.js';

dotenv.config();

/**
 * Strips HTML tags and entities to return clean text.
 */
function cleanHtmlText(html = '') {
  if (!html) return '';
  // Decode XML-encoded HTML brackets/entities first so they form actual HTML tags
  let decoded = html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
  
  // Now strip all HTML tags
  return decoded
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')                 // Normalize spaces
    .trim();
}

/**
 * Parses step descriptions and expected results from ADO's Microsoft.VSTS.TCM.Steps XML.
 */
function parseStepsFromXml(xml = '') {
  if (!xml) return [];
  const steps = [];
  
  // Match each step block individually
  const stepRegex = /<step[^>]*>([\s\S]*?)<\/step>/g;
  let stepMatch;
  
  while ((stepMatch = stepRegex.exec(xml)) !== null) {
    const stepContent = stepMatch[1];
    
    // Find only the first parameterizedString inside this step (which represents the action)
    const paramRegex = /<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/;
    const paramMatch = paramRegex.exec(stepContent);
    
    if (paramMatch) {
      const actionText = cleanHtmlText(paramMatch[1]);
      if (actionText) {
        steps.push(actionText);
      }
    }
  }
  return steps;
}

/**
 * Extracts a test prompt from the work item fields.
 * Prioritizes description, falls back to steps, then to the title.
 */
function extractPrompt(workItem) {
  const cleanDescription = cleanHtmlText(workItem.description);
  
  // 1. If we have a description, use it as the main prompt
  if (cleanDescription && cleanDescription.length > 5) {
    return cleanDescription;
  }

  // 2. Fallback to test case steps
  const steps = parseStepsFromXml(workItem.stepsXml);
  if (steps.length > 0) {
    // Group actions and expectations with a newline after each comma
    return steps.join(',\n');
  }

  // 3. Fallback to the title if everything else is empty
  return `Verify scenario: ${workItem.title}`;
}

/**
 * Synchronizes scenarios from Azure DevOps and writes them to scenarios.yaml.
 */
export async function syncScenarios() {
  const org = process.env.ADO_ORG;
  const project = process.env.ADO_PROJECT;
  const pat = process.env.ADO_PAT;
  const planId = process.env.ADO_PLAN_ID;
  const suiteId = process.env.ADO_SUITE_ID;

  if (!org || !project || !pat || !planId || !suiteId) {
    console.warn('[ADO Sync Warning] Missing Azure DevOps configuration. Sync skipped.');
    return false;
  }

  console.log(`[ADO Sync] Synchronizing scenarios from ADO Plan ${planId}, Suite ${suiteId}...`);

  try {
    const client = new AdoClient(org, project, pat);
    
    // 1. Fetch test case references from the suite
    const testCases = await client.fetchTestCasesFromSuite(planId, suiteId);
    console.log(`[ADO Sync] Found ${testCases.length} test cases in suite.`);
    
    if (testCases.length === 0) {
      console.warn('[ADO Sync Warning] No test cases found in suite. local scenarios.yaml will not be updated.');
      return false;
    }

    // 2. Fetch full work item details
    const ids = testCases.map(tc => tc.id);
    const workItems = await client.fetchWorkItemDetails(ids);
    
    // 3. Map to standard scenarios.yaml schema
    const scenarios = workItems.map(item => {
      const prompt = extractPrompt(item);
      return {
        name: item.title,
        prompt: prompt
      };
    });

    const yamlContent = yaml.dump({ scenarios });
    const outputPath = path.resolve('scenarios.yaml');
    
    // Write out the configuration
    await fs.writeFile(outputPath, yamlContent, 'utf-8');
    console.log(`[ADO Sync] Successfully synced and wrote ${scenarios.length} scenarios to ${outputPath}`);
    return true;
  } catch (err) {
    console.error('[ADO Sync Error] Synchronization failed:', err.message);
    return false;
  }
}
