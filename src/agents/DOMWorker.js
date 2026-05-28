import { chromium } from 'playwright';
import crypto from 'crypto';
import messageBus, { EVENTS } from '../core/MessageBus.js';
import memoryAgent from './MemoryAgent.js';

class DOMWorker {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    await messageBus.subscribe(EVENTS.DOM_EXTRACT_REQUESTED, async (payload) => {
      console.log(`[DOMWorker] Received DOM_EXTRACT_REQUESTED for target URL: ${payload.targetUrl}`);
      try {
        const result = await this.extractDOM(payload);
        await messageBus.publish(EVENTS.DOM_EXTRACTED, result);
      } catch (err) {
        console.error('[DOMWorker Error] Extraction failed:', err);
        await messageBus.publish(EVENTS.DOM_EXTRACT_FAILED, {
          runId: payload.runId,
          domain: payload.domain,
          error: err.message
        });
      }
    });

    this.initialized = true;
    console.log('[DOMWorker] Subscribed to dom.extract.requested.');
  }

  async extractDOM(payload) {
    const { runId, domain, targetUrl, useCache } = payload;
    
    await memoryAgent.connect();

    // 1. Check cache first if requested
    if (useCache) {
      console.log(`[DOMWorker] Checking cached DOM snapshot for domain: ${domain}...`);
      const cached = await memoryAgent.getLatestDomSnapshot(domain);
      if (cached) {
        console.log(`[DOMWorker] Cache hit! Found snapshot with hash: ${cached.snapshotHash}`);
        return {
          runId,
          domain,
          url: cached.url,
          snapshot: cached,
          snapshotHash: cached.snapshotHash,
          volatilitySignal: 'stable'
        };
      }
      console.log('[DOMWorker] Cache miss or no cached snapshot found. Falling back to live crawl.');
    }

    // 2. Live DOM crawl using Playwright
    console.log(`[DOMWorker] Crawling live website: ${targetUrl}...`);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Set typical viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    
    let elements = [];
    let hasShadowDom = false;
    let urlAfterNav = targetUrl;

    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
      urlAfterNav = page.url();
      
      // Inject script to extract interactive elements, including piercing Shadow DOM
      elements = await page.evaluate(() => {
        const interactiveElements = [];
        
        function scan(root) {
          if (!root) return;

          // Piercing Shadow DOM
          const shadowRoots = [];
          
          // Helper to find shadow roots recursively
          const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            null
          );
          
          let node = walker.nextNode();
          while (node) {
            if (node.shadowRoot) {
              shadowRoots.push(node.shadowRoot);
            }
            
            // Check if element is interactive
            const tagName = node.tagName.toLowerCase();
            const isButton = tagName === 'button' || node.getAttribute('role') === 'button';
            const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
            const isLink = tagName === 'a';
            const hasClick = node.onclick != null || node.getAttribute('listener') === 'click';
            
            if (isButton || isInput || isLink || hasClick) {
              interactiveElements.push({
                tagName,
                id: node.id || null,
                className: node.className || null,
                placeholder: node.placeholder || node.getAttribute('placeholder') || null,
                type: node.type || node.getAttribute('type') || null,
                name: node.name || node.getAttribute('name') || null,
                value: node.value || null,
                role: node.getAttribute('role') || null,
                testId: node.getAttribute('data-testid') || node.getAttribute('data-test-id') || null,
                innerText: node.innerText?.trim().substring(0, 100) || null,
                ariaLabel: node.getAttribute('aria-label') || null,
                outerHTML: node.outerHTML.substring(0, 300) // limited snippet
              });
            }
            node = walker.nextNode();
          }

          // Scan all nested shadow roots found
          for (const shadowRoot of shadowRoots) {
            scan(shadowRoot);
          }
        }
        
        scan(document.body);
        return interactiveElements;
      });

      // Detect if site uses web components or shadow roots
      hasShadowDom = await page.evaluate(() => {
        function checkShadow(root) {
          if (!root) return false;
          if (root.shadowRoot) return true;
          for (let i = 0; i < root.children.length; i++) {
            if (checkShadow(root.children[i])) return true;
          }
          return false;
        }
        return checkShadow(document.body);
      });

    } finally {
      await browser.close();
    }

    // 3. Compute structural hash of DOM
    const serialized = JSON.stringify(elements.map(e => ({ tagName: e.tagName, id: e.id, className: e.className, name: e.name })));
    const snapshotHash = crypto.createHash('sha256').update(serialized).digest('hex');

    // 4. Check for differences against previous snapshot in database
    const previousSnapshot = await memoryAgent.getLatestDomSnapshot(domain);
    let volatilitySignal = 'first_run';
    let diffSummary = null;

    if (previousSnapshot) {
      if (previousSnapshot.snapshotHash === snapshotHash) {
        volatilitySignal = 'stable';
      } else {
        volatilitySignal = 'changed';
        
        // Compute element differences
        const prevTags = previousSnapshot.elements.map(e => e.tagName);
        const currTags = elements.map(e => e.tagName);
        diffSummary = {
          previousElementCount: previousSnapshot.elements.length,
          currentElementCount: elements.length,
          diffCount: Math.abs(elements.length - previousSnapshot.elements.length)
        };
      }
    }

    const snapshot = {
      runId,
      domain,
      url: urlAfterNav,
      extractedAt: new Date(),
      elements,
      snapshotHash,
      previousSnapshotHash: previousSnapshot ? previousSnapshot.snapshotHash : null,
      diffSummary
    };

    // 5. Save to MongoDB
    await memoryAgent.saveDomSnapshot(snapshot);

    // 6. Update Site Profile in Postgres
    await memoryAgent.createOrUpdateSiteProfile(domain, {
      shadow_dom: hasShadowDom,
      volatility: volatilitySignal === 'changed' ? 'high' : (previousSnapshot ? 'medium' : 'low'),
      last_run_at: new Date()
    });

    console.log(`[DOMWorker] Finished extraction. Total interactive elements: ${elements.length}, Hash: ${snapshotHash}, Volatility: ${volatilitySignal}`);
    
    return {
      runId,
      domain,
      url: urlAfterNav,
      snapshot,
      snapshotHash,
      volatilitySignal
    };
  }
}

const domWorker = new DOMWorker();
export default domWorker;
