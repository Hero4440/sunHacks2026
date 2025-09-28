# Extension Context Invalidation Debug Plan

## Problem Summary
The Nebula Chrome extension is experiencing "Extension context invalidated" errors that occur when:
1. Service worker ping attempts fail repeatedly (7+ attempts)
2. The extension is reloaded while content scripts are still running
3. The keepalive connection attempts to reconnect in an infinite loop

## Error Analysis

### Current Error Pattern
```
Nebula: Ping attempt 1-7 failed: Error: Message timeout after 3000ms
Failed to create keepalive port Error: Extension context invalidated.
```

### Root Causes Identified

1. **Service Worker Sleep State**: The background service worker goes dormant, causing ping timeouts
2. **Extension Reload During Runtime**: When extension is reloaded, old content scripts lose connection to new service worker
3. **Missing Context Validation**: No proper validation before attempting runtime operations
4. **Infinite Reconnection Loop**: Original code lacks circuit breaker for failed connections

## Current Implementation Issues

### Location: `content.js:928-961`
- Changes were reverted to original problematic code
- No context validation before `chrome.runtime.connect()`
- No circuit breaker for failed connections
- No graceful handling of context invalidation

## Debug Plan

### Phase 1: Immediate Fixes
1. **Re-implement Context Validation**
   - Add `chrome.runtime?.id` checks before all runtime operations
   - Implement proper error detection for "Extension context invalidated"

2. **Circuit Breaker Implementation**
   - Limit connection attempts to maximum 5 retries
   - Add exponential backoff for reconnection attempts
   - Stop all attempts when context is confirmed invalid

3. **Enhanced Logging**
   - Add detailed debug logs for each connection attempt
   - Track connection state and failure reasons
   - Log service worker ping attempts and responses

### Phase 2: Service Worker Management
1. **Service Worker Wake Strategy**
   - Implement proper service worker wake mechanism
   - Add service worker lifecycle detection
   - Handle service worker dormancy gracefully

2. **Background Script Improvements**
   - Ensure background script responds to keepalive pings
   - Add proper message handling for KEEPALIVE messages
   - Implement service worker self-healing mechanisms

### Phase 3: Comprehensive Testing
1. **Extension Reload Scenarios**
   - Test extension reload while content scripts are active
   - Verify graceful degradation when context is invalidated
   - Ensure no infinite loops or excessive retries

2. **Service Worker Dormancy**
   - Test behavior when service worker goes to sleep
   - Verify wake mechanisms work correctly
   - Test timeout handling and recovery

## Implementation Strategy

### Step 1: Fix Keepalive Connection Logic
```javascript
establishKeepAlive() {
  let connectionAttempts = 0;
  const maxAttempts = 5;
  let contextInvalidated = false;

  const connect = () => {
    if (contextInvalidated || connectionAttempts >= maxAttempts) {
      console.debug("Keepalive disabled - context invalid or max attempts reached");
      return;
    }

    try {
      // Validate extension context before attempting connection
      if (!chrome.runtime?.id) {
        console.debug("Extension context invalidated, stopping keepalive");
        contextInvalidated = true;
        return;
      }

      connectionAttempts++;
      const port = chrome.runtime.connect({ name: "nebula-keepalive" });
      // ... rest of connection logic
    } catch (error) {
      if (error.message?.includes("Extension context invalidated")) {
        contextInvalidated = true;
        return;
      }
      // Implement exponential backoff for retries
    }
  };
}
```

### Step 2: Service Worker Ping Improvements
```javascript
async wakeServiceWorker() {
  const maxPingAttempts = 3; // Reduced from 8
  for (let attempt = 1; attempt <= maxPingAttempts; attempt++) {
    try {
      if (!chrome.runtime?.id) {
        console.debug("Extension context invalidated during ping");
        return false;
      }

      const response = await this.sendMessage({ type: "PING" }, { timeout: 3000 });
      if (response?.type === "PONG") {
        return true;
      }
    } catch (error) {
      if (error.message?.includes("Extension context invalidated")) {
        console.debug("Extension context invalidated, stopping ping attempts");
        return false;
      }
      console.debug(`Ping attempt ${attempt} failed:`, error);
    }
  }
  return false;
}
```

### Step 3: Background Script Enhancements
Ensure background script properly handles:
- PING/PONG messages for keepalive
- Proper service worker lifecycle management
- Message routing and response handling

## Testing Checklist

### Scenario 1: Normal Operation
- [ ] Extension loads without errors
- [ ] Keepalive connection establishes successfully
- [ ] Service worker responds to pings
- [ ] No infinite loops or excessive retries

### Scenario 2: Extension Reload
- [ ] Old content scripts detect context invalidation
- [ ] Keepalive attempts stop gracefully
- [ ] No "Extension context invalidated" errors in console
- [ ] New content scripts initialize properly

### Scenario 3: Service Worker Dormancy
- [ ] Service worker wakes up on ping attempts
- [ ] Keepalive reconnects after service worker sleep
- [ ] Timeout handling works correctly
- [ ] Circuit breaker prevents infinite retries

## Success Criteria

1. **Zero "Extension context invalidated" errors** in console
2. **Maximum 5 connection attempts** before giving up
3. **Graceful degradation** when extension context is lost
4. **Proper service worker lifecycle management**
5. **No infinite loops or excessive resource usage**

## Monitoring and Validation

### Debug Logging
Enable detailed logging to track:
- Connection attempt counts
- Context validation results
- Service worker ping success/failure
- Error patterns and frequency

### Performance Metrics
Monitor:
- CPU usage during reconnection attempts
- Memory usage of content scripts
- Network requests for keepalive connections
- Console error frequency

## Next Steps

1. Implement the fixes in the order specified
2. Test each phase thoroughly before proceeding
3. Monitor console output for debug information
4. Validate success criteria are met
5. Document final solution for future reference