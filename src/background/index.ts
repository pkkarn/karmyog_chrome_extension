// Chrome Extension Background Service Worker

// Listen for global shortcut commands
chrome.commands.onCommand.addListener((command) => {
  if (command === 'trigger-task-form' || command === 'trigger-task-list') {
    // Find the currently active tab in the focused window
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id) {
        // Send a message to the content script of the active tab
        const action = command === 'trigger-task-form' ? 'TRIGGER_MODAL' : 'TRIGGER_LIST';
        chrome.tabs.sendMessage(activeTab.id, { action }, (response) => {
          // Suppress errors that might occur on system tabs where content scripts aren't loaded (e.g. chrome://)
          if (chrome.runtime.lastError) {
            console.log('Karm Yog: Command not sent. Script may not be loaded on this page.');
          } else {
            console.log(`Karm Yog: Trigger command ${command} sent to active tab`, response);
          }
        });
      }
    });
  }
});

// Set up default settings on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['tasks'], (result) => {
    if (!result.tasks) {
      chrome.storage.local.set({ tasks: [] }, () => {
        console.log('Karm Yog: Initialized empty task storage.');
      });
    }
  });
});
