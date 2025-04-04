<template>
  <NuxtLayout name="default">
    <div class="stats-dashboard">
      <h1>Ziit Stats Dashboard</h1>
      
      <div class="stats-summary">
        <div class="stats-card">
          <h2>Today</h2>
          <div class="stats-time" v-if="todayStats">
            <span class="time-value">{{ formatTime(todayStats.totalSeconds) }}</span>
          </div>
          <div v-else>Loading...</div>
        </div>
        
        <div class="stats-card">
          <h2>This Week</h2>
          <div class="stats-time" v-if="weekStats">
            <span class="time-value">{{ formatTime(weekStats.totalSeconds) }}</span>
          </div>
          <div v-else>Loading...</div>
        </div>
      </div>
      
      <div class="projects-section" v-if="todayStats">
        <h2>Today's Projects</h2>
        <div class="projects-list">
          <div v-for="(seconds, project) in todayStats.projects" :key="project" class="project-item">
            <div class="project-name">{{ project }}</div>
            <div class="project-time">{{ formatTime(seconds) }}</div>
            <div class="project-bar">
              <div class="project-bar-fill" :style="{ width: (seconds / todayStats.totalSeconds * 100) + '%' }"></div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="heartbeats-section">
        <h2>Recent Heartbeats</h2>
        <div v-if="recentHeartbeats.length > 0" class="heartbeats-list">
          <div v-for="(heartbeat, index) in recentHeartbeats" :key="index" class="heartbeat-item">
            <div>{{ new Date(heartbeat.timestamp).toLocaleTimeString() }}</div>
            <div class="heartbeat-project">{{ heartbeat.project }}</div>
            <div class="heartbeat-file">{{ getFileName(heartbeat.file) }}</div>
          </div>
        </div>
        <div v-else>No recent heartbeats found</div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const todayStats = ref(null)
const weekStats = ref(null)
const recentHeartbeats = ref([])

onMounted(async () => {
  await fetchStats()
  await fetchRecentHeartbeats()
  
  setInterval(async () => {
    await fetchStats()
    await fetchRecentHeartbeats()
  }, 60000)
})

async function fetchStats() {
  try {
    const today = new Date().toISOString().split('T')[0]
    const todayData = await $fetch(`/api/stats/daily?startDate=${today}`)
    
    if (todayData && todayData.length > 0) {
      todayStats.value = todayData[0]
    }
    
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 7)
    const weekStartStr = weekStart.toISOString().split('T')[0]
    
    const weekData = await $fetch(`/api/stats/daily?startDate=${weekStartStr}&endDate=${today}`)
    
    if (weekData && weekData.length > 0) {
      const totalSeconds = weekData.reduce((sum, day) => sum + day.totalSeconds, 0)
      
      const projects = {}
      weekData.forEach(day => {
        Object.entries(day.projects).forEach(([project, seconds]) => {
          if (!projects[project]) {
            projects[project] = 0
          }
          projects[project] += seconds
        })
      })
      
      weekStats.value = {
        totalSeconds,
        projects
      }
    }
  } catch (error) {
    console.error('Error fetching stats:', error)
  }
}

async function fetchRecentHeartbeats() {
  try {
    const data = await $fetch('/api/heartbeats/recent')
    recentHeartbeats.value = data
  } catch (error) {
    console.error('Error fetching recent heartbeats:', error)
  }
}

function formatTime(seconds) {
  if (!seconds) return '0h 0m'
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  return `${hours}h ${minutes}m`
}

function getFileName(filePath) {
  if (!filePath) return 'unknown'
  return filePath.split('/').pop()
}
</script>

<style lang="scss">
@use "/styles/index.scss";

.stats-dashboard {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  
  h1 {
    font-size: 2rem;
    margin-bottom: 2rem;
    text-align: center;
  }
  
  .stats-summary {
    display: flex;
    gap: 2rem;
    margin-bottom: 2rem;
    
    .stats-card {
      flex: 1;
      padding: 1.5rem;
      border-radius: 8px;
      background-color: #f8f9fa;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      
      h2 {
        margin-top: 0;
        margin-bottom: 1rem;
        font-size: 1.25rem;
        color: #333;
      }
      
      .stats-time {
        font-size: 2rem;
        font-weight: bold;
        color: #007bff;
      }
    }
  }
  
  .projects-section, .heartbeats-section {
    margin-top: 2rem;
    padding: 1.5rem;
    border-radius: 8px;
    background-color: #f8f9fa;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    
    h2 {
      margin-top: 0;
      margin-bottom: 1rem;
      font-size: 1.25rem;
      color: #333;
    }
  }
  
  .projects-list {
    .project-item {
      display: flex;
      flex-wrap: wrap;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #e9ecef;
      
      .project-name {
        flex: 1;
        font-weight: bold;
      }
      
      .project-time {
        width: 100px;
        text-align: right;
      }
      
      .project-bar {
        flex-basis: 100%;
        height: 8px;
        margin-top: 0.5rem;
        background-color: #e9ecef;
        border-radius: 4px;
        overflow: hidden;
        
        .project-bar-fill {
          height: 100%;
          background-color: #007bff;
        }
      }
    }
  }
  
  .heartbeats-list {
    .heartbeat-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #e9ecef;
      font-size: 0.9rem;
      
      .heartbeat-project {
        font-weight: bold;
      }
      
      .heartbeat-file {
        color: #6c757d;
        max-width: 250px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }
}
</style>
