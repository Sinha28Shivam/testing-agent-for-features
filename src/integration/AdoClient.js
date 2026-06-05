/**
 * AdoClient interacts with the Azure DevOps REST API.
 * It uses the Personal Access Token (PAT) for basic authentication.
 */
class AdoClient {
  constructor(org, project, pat) {
    if (!org || !project || !pat) {
      throw new Error('Azure DevOps client requires organization, project, and PAT.');
    }
    this.org = org;
    this.project = project;
    this.baseUrl = `https://dev.azure.com/${org}/${project}`;
    
    // Auth header format for ADO: Basic Base64(":" + PAT)
    const token = Buffer.from(`:${pat}`).toString('base64');
    this.headers = {
      'Authorization': `Basic ${token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Fetches the list of test cases in a Test Suite.
   * @param {string|number} planId - The Test Plan ID
   * @param {string|number} suiteId - The Test Suite ID
   * @returns {Promise<Array>} - List of test case descriptors { id, url, name }
   */
  async fetchTestCasesFromSuite(planId, suiteId) {
    const url = `${this.baseUrl}/_apis/test/Plans/${planId}/Suites/${suiteId}/testcases?api-version=7.0`;
    console.log(`[ADO Client] Fetching test cases from plan ${planId}, suite ${suiteId}...`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch test cases from suite. Status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (!data.value || !Array.isArray(data.value)) {
      return [];
    }

    return data.value.map(item => ({
      id: item.testCase?.id,
      url: item.testCase?.url,
      name: item.testCase?.name
    })).filter(tc => tc.id);
  }

  /**
   * Fetches work item details (Title, Description, and Steps) for a list of work item IDs.
   * @param {Array<string|number>} ids - Array of work item IDs
   * @returns {Promise<Array>} - List of work item details
   */
  async fetchWorkItemDetails(ids) {
    if (!ids || ids.length === 0) return [];
    
    const idList = ids.join(',');
    const fields = 'System.Title,System.Description,Microsoft.VSTS.TCM.Steps';
    const url = `https://dev.azure.com/${this.org}/${this.project}/_apis/wit/workitems?ids=${idList}&fields=${fields}&api-version=7.0`;
    
    console.log(`[ADO Client] Fetching work item details for IDs: ${idList}...`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch work item details. Status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (!data.value || !Array.isArray(data.value)) {
      return [];
    }

    return data.value.map(item => ({
      id: item.id,
      title: item.fields?.['System.Title'],
      description: item.fields?.['System.Description'] || '',
      stepsXml: item.fields?.['Microsoft.VSTS.TCM.Steps'] || ''
    }));
  }
}

export default AdoClient;
