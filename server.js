// backend/server.js
// Main Express server with API endpoints and scheduled jobs

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Simple in-memory database (no file system needed)
const matches = [];
const portfolio = { totalBets: 0, profit: 0, roi: 0 };

// API Endpoints

// Get today's matches with predictions
app.get('/api/matches/today', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Return sample data for now
    const sampleMatches = [
      {
        id: 'match_1',
        date: today,
        playerA: 'Jannik Sinner',
        playerB: 'Carlos Alcaraz',
        tournament: 'Australian Open',
        surface: 'Hard',
        modelProb: 0.58,
        impliedProb: 0.52,
        edge: 11.54,
        confidence: 0.68,
        recommendedStake: 310,
        expectedRoi: 9.2,
        oddsA: 1.92,
        oddsB: 1.92,
      },
      {
        id: 'match_2',
        date: today,
        playerA: 'Novak Djokovic',
        playerB: 'Andrey Rublev',
        tournament: 'Australian Open',
        surface: 'Hard',
        modelProb: 0.72,
        impliedProb: 0.67,
        edge: 7.46,
        confidence: 0.82,
        recommendedStake: 420,
        expectedRoi: 12.5,
        oddsA: 1.50,
        oddsB: 2.60,
      },
      {
        id: 'match_3',
        date: today,
        playerA: 'Taylor Fritz',
        playerB: 'Grigor Dimitrov',
        tournament: 'Australian Open',
        surface: 'Hard',
        modelProb: 0.51,
        impliedProb: 0.52,
        edge: -2.1,
        confidence: 0.02,
        recommendedStake: 0,
        expectedRoi: -2.1,
        oddsA: 1.92,
        oddsB: 1.92,
      },
    ];

    const stats = {
      totalMatches: sampleMatches.length,
      edgesDetected: sampleMatches.filter(m => m.edge >= 5).length,
      avgEdge: (sampleMatches.filter(m => m.edge >= 5).reduce((sum, m) => sum + m.edge, 0) / Math.max(1, sampleMatches.filter(m => m.edge >= 5).length)).toFixed(2),
    };

    res.json({
      success: true,
      date: today,
      matches: sampleMatches,
      stats,
    });
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get portfolio summary
app.get('/api/portfolio', (req, res) => {
  try {
    res.json({
      success: true,
      portfolio: {
        totalBets: portfolio.totalBets,
        wins: Math.floor(portfolio.totalBets * 0.56),
        losses: Math.floor(portfolio.totalBets * 0.44),
        profit: portfolio.profit,
        roi: portfolio.roi,
      },
    });
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🎾 Tennis Betting Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔄 API: http://localhost:${PORT}/api/matches/today\n`);
});

module.exports = app;
