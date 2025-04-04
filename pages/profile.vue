<template>
  <NuxtLayout name="default">
    <div class="profile-container">
      <h1>Your Profile</h1>
      
      <div v-if="user" class="profile-content">
        <div class="user-info">
          <div class="info-group">
            <h2>Account Information</h2>
            <div class="info-row">
              <div class="info-label">Username:</div>
              <div class="info-value">{{ user.name }}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Email:</div>
              <div class="info-value">{{ user.email }}</div>
            </div>
            <div class="info-row">
              <div class="info-label">GitHub Connected:</div>
              <div class="info-value">{{ user.hasGithubAccount ? 'Yes' : 'No' }}</div>
            </div>
          </div>
          
          <div class="info-group">
            <h2>API Key</h2>
            <p class="subtitle">Use this key to authenticate with the VS Code extension</p>
            <div class="api-key-container">
              <div class="api-key" v-if="!showApiKey">
                •••••••••••••••••••••••••••••••
              </div>
              <div class="api-key" v-else>
                {{ user.apiKey }}
              </div>
              <button @click="toggleApiKey" class="toggle-key-btn">
                {{ showApiKey ? 'Hide' : 'Show' }}
              </button>
              <button @click="copyApiKey" class="copy-key-btn">
                Copy
              </button>
            </div>
            <div class="api-key-actions">
              <button @click="regenerateApiKey" class="regenerate-btn">Regenerate API Key</button>
            </div>
          </div>
          
          <div class="info-group">
            <h2>VS Code Extension Setup</h2>
            <ol class="setup-steps">
              <li>Install the Ziit extension from the VS Code marketplace</li>
              <li>Open VS Code and press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on Windows)</li>
              <li>Type "Ziit: Set API Key" and press Enter</li>
              <li>Paste your API key and press Enter</li>
              <li>Begin coding, and your time will be tracked automatically!</li>
            </ol>
          </div>
        </div>
      </div>
      
      <div v-else class="loading">
        Loading user information...
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const user = ref(null)
const showApiKey = ref(false)

onMounted(async () => {
  await fetchUserData()
})

async function fetchUserData() {
  try {
    const data = await $fetch('/api/auth/user')
    user.value = data
  } catch (error) {
    console.error('Error fetching user data:', error)
  }
}

function toggleApiKey() {
  showApiKey.value = !showApiKey.value
}

async function copyApiKey() {
  if (!user.value?.apiKey) return
  
  try {
    await navigator.clipboard.writeText(user.value.apiKey)
    alert('API Key copied to clipboard')
  } catch (error) {
    console.error('Failed to copy API key:', error)
  }
}

async function regenerateApiKey() {
  if (!confirm('Are you sure you want to regenerate your API key? Your existing VS Code extension setup will stop working until you update it.')) {
    return
  }
  
  try {
    const data = await $fetch('/api/auth/apikey', {
      method: 'POST'
    })
    
    user.value.apiKey = data.apiKey
    showApiKey.value = true
    alert('Your API key has been regenerated. Update it in your VS Code extension settings.')
  } catch (error) {
    console.error('Error regenerating API key:', error)
    alert('Failed to regenerate API key. Please try again.')
  }
}
</script>

<style lang="scss">
.profile-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  
  h1 {
    font-size: 2rem;
    margin-bottom: 2rem;
    text-align: center;
  }
  
  .profile-content {
    background-color: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    overflow: hidden;
  }
  
  .user-info {
    padding: 2rem;
  }
  
  .info-group {
    margin-bottom: 2rem;
    padding-bottom: 2rem;
    border-bottom: 1px solid #eee;
    
    &:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }
    
    h2 {
      margin-top: 0;
      margin-bottom: 1rem;
      font-size: 1.5rem;
      color: #333;
    }
    
    .subtitle {
      color: #666;
      margin-bottom: 1rem;
    }
  }
  
  .info-row {
    display: flex;
    margin-bottom: 0.5rem;
    
    .info-label {
      width: 150px;
      font-weight: bold;
      color: #666;
    }
    
    .info-value {
      flex: 1;
    }
  }
  
  .api-key-container {
    display: flex;
    align-items: center;
    margin-bottom: 1rem;
    
    .api-key {
      flex: 1;
      padding: 0.75rem;
      background-color: #f5f5f5;
      border-radius: 4px;
      font-family: monospace;
      word-break: break-all;
    }
    
    button {
      margin-left: 0.5rem;
      padding: 0.5rem 1rem;
      background-color: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      
      &:hover {
        background-color: #e5e5e5;
      }
    }
  }
  
  .api-key-actions {
    .regenerate-btn {
      padding: 0.5rem 1rem;
      background-color: #dc3545;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      
      &:hover {
        background-color: #c82333;
      }
    }
  }
  
  .setup-steps {
    padding-left: 1.5rem;
    
    li {
      margin-bottom: 0.75rem;
    }
    
    kbd {
      display: inline-block;
      padding: 0.2rem 0.4rem;
      font-size: 0.9rem;
      font-family: monospace;
      line-height: 1;
      color: #444;
      background-color: #f7f7f7;
      border: 1px solid #ccc;
      border-radius: 3px;
      box-shadow: 0 1px 0 rgba(0,0,0,0.2);
    }
  }
  
  .loading {
    text-align: center;
    padding: 2rem;
    color: #666;
  }
}
</style>
