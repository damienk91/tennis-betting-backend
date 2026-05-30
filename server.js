// backend/server.js
// Main Express server with API endpoints and scheduled jobs

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database setup
const dbPath = process.env.DATABASE_URL || path.join(__dirname, 'db', 'tennis.db');
const db = new Database(dbPath);

// Initialize database
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      tournament TEXT NOT NULL,
      surface TEXT NOT NULL,
      playerA TEXT NOT NULL,
      playerB TEXT NOT NULL,
      modelProb REAL,
      impliedProb REAL,
      edge REAL,
      confidence REAL,
      recommendedStake REAL,
      expectedRoi REAL,
      oddsA REAL,
      oddsB REAL,
      winner TEXT,
      actualResult TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matchId TEXT NOT NULL,
      betType TEXT NOT NULL,
      stakeSize REAL NOT NULL,
      odds REAL NOT NULL,
      result TEXT,
      profit REAL,
      placedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      settledAt DATETIME,
      FOREIGN KEY (matchId) REFERENCES matches(id)
    );

    CREATE TABLE IF NOT EXISTS predictions_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      totalMatches INTEGER,
      edgesDetected INTEGER,
      avgEdge REAL,
      totalStaked REAL,
      roi REAL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
    CREATE INDEX IF NOT EXISTS idx_matches_player ON matches(playerA, playerB);
  `);
}

// Data Fetching Services
async function fetchTennisExplorerData() {
  // TODO: Replace with actual Tennis Explorer API or web scraping
  // For now, return mock data
  return [
    {
      id: 'match_20250130_sinner_alcaraz',
      date: new Date().toISOString().split('T')[0],
      tournament: 'Australian Open',
      surface: 'Hard',
      playerA: 'Jannik Sinner',
      playerB: 'Carlos Alcaraz',
      matchTime: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'match_20250130_djokovic_rublev',
      date: new Date().toISOString().split('T')[0],
      tournament: 'Australian Open',
      surface: 'Hard',
      playerA: 'Novak Djokovic',
      playerB: 'Andrey Rublev',
      matchTime: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

async function fetchLiveOdds(matches) {
  // TODO: Integrate with Betfair, Pinnacle, or betting API
  // For now, return mock odds
  return matches.map((m) => ({
    ...m,
    oddsA: 1.85 + Math.random() * 0.5,
    oddsB: 1.85 + Math.random() * 0.5,
  }));
}

// Model Inference
async function runModelInference(match) {
  return new Promise((resolve, reject) => {
    // Call Python script for model inference
    const python = spawn('python', [
      path.join(__dirname, 'python', 'predict.py'),
      JSON.stringify(match),
    ]);

    let output = '';
    let error = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      error += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('Python inference error:', error);
        reject(new Error(`Python process exited with code ${code}`));
      } else {
        try {
          const result = JSON.parse(output);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

// Calculate Kelly Stake
function calculateKellyStake(modelProb, odds, bankroll, kellyFraction = 0.25) {
  const b = odds - 1;
  const q = 1 - modelProb;
  
  // Full Kelly formula: f* = (bp - q) / b
  const fStar = (b * modelProb - q) / b;
  
  // Fractional Kelly
  const f = Math.max(0, Math.min(fStar * kellyFraction, 0.05)); // Cap at 5% per bet
  
  return bankroll * f;
}

// Main prediction pipeline
async function updatePredictions() {
  try {
    console.log(`[${new Date().toISOString()}] Starting prediction update...`);

    // 1. Fetch match data
    const matches = await fetchTennisExplorerData();
    console.log(`  - Fetched ${matches.length} matches`);

    // 2. Fetch live odds
    const matchesWithOdds = await fetchLiveOdds(matches);

    // 3. Run model inference and calculate metrics
    const predictions = await Promise.all(
      matchesWithOdds.map(async (match) => {
        try {
          const modelResult = await runModelInference(match);
          
          const modelProb = modelResult.probability;
          const impliedProb = 1 / match.oddsA;
          const edge = ((modelProb - impliedProb) / impliedProb) * 100;
          const confidence = Math.abs(modelProb - 0.5) * 2; // 0-1, peaking at 0.5 prob diff
          const recommendedStake = calculateKellyStake(
            modelProb,
            match.oddsA,
            10000 // Default bankroll
          );
          const expectedRoi = (modelProb * (match.oddsA - 1) - (1 - modelProb)) * 100;

          return {
            ...match,
            modelProb,
            impliedProb,
            edge,
            confidence,
            recommendedStake,
            expectedRoi,
          };
        } catch (error) {
          console.error(`  Error predicting ${match.id}:`, error);
          return null;
        }
      })
    );

    const validPredictions = predictions.filter(Boolean);

    // 4. Store in database
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO matches 
      (id, date, tournament, surface, playerA, playerB, modelProb, impliedProb, 
       edge, confidence, recommendedStake, expectedRoi, oddsA, oddsB, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const insertMany = db.transaction((predictions) => {
      for (const pred of predictions) {
        stmt.run(
          pred.id,
          pred.date,
          pred.tournament,
          pred.surface,
          pred.playerA,
          pred.playerB,
          pred.modelProb,
          pred.impliedProb,
          pred.edge,
          pred.confidence,
          pred.recommendedStake,
          pred.expectedRoi,
          pred.oddsA,
          pred.oddsB
        );
      }
    });

    insertMany(validPredictions);

    // 5. Log summary
    const edgeCount = validPredictions.filter((p) => p.edge >= 5).length;
    const avgEdge = validPredictions.length > 0
      ? validPredictions
          .filter((p) => p.edge >= 5)
          .reduce((sum, p) => sum + p.edge, 0) / edgeCount
      : 0;

    const summary = {
      date: new Date().toISOString().split('T')[0],
      totalMatches: validPredictions.length,
      edgesDetected: edgeCount,
      avgEdge,
      totalStaked: validPredictions
        .filter((p) => p.edge >= 5)
        .reduce((sum, p) => sum + p.recommendedStake, 0),
      roi: 0, // Will be calculated from portfolio
    };

    db.prepare(`
      INSERT INTO predictions_history 
      (date, totalMatches, edgesDetected, avgEdge, totalStaked, roi)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      summary.date,
      summary.totalMatches,
      summary.edgesDetected,
      summary.avgEdge,
      summary.totalStaked,
      summary.roi
    );

    console.log(`  ✓ Updated: ${edgeCount} edges from ${validPredictions.length} matches`);
    return summary;
  } catch (error) {
    console.error('Error in updatePredictions:', error);
    throw error;
  }
}

// API Endpoints

// Get today's matches with predictions
app.get('/api/matches/today', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const matches = db
      .prepare('SELECT * FROM matches WHERE date = ? ORDER BY edge DESC')
      .all(today);

    const stats = {
      totalMatches: matches.length,
      edgesDetected: matches.filter((m) => m.edge >= 5).length,
      avgEdge:
        matches.filter((m) => m.edge >= 5).length > 0
          ? (
              matches
                .filter((m) => m.edge >= 5)
                .reduce((sum, m) => sum + m.edge, 0) /
              matches.filter((m) => m.edge >= 5).length
            ).toFixed(2)
          : 0,
    };

    res.json({
      success: true,
      date: today,
      matches,
      stats,
    });
  } catch (error) {
    console.error('Error fetching today\'s matches:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get portfolio summary
app.get('/api/portfolio', (req, res) => {
  try {
    const portfolio = db.prepare(`
      SELECT 
        COUNT(*) as totalBets,
        SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) as losses,
        SUM(profit) as totalProfit,
        AVG(CASE WHEN result = 'WIN' THEN profit ELSE NULL END) as avgWin,
        AVG(CASE WHEN result = 'LOSS' THEN profit ELSE NULL END) as avgLoss
      FROM portfolio
      WHERE settledAt IS NOT NULL
    `).get();

    const roi = portfolio && portfolio.totalBets > 0
      ? ((portfolio.totalProfit / (portfolio.totalBets * 100)) * 100) // Assuming $100 avg bet
      : 0;

    res.json({
      success: true,
      portfolio: {
        totalBets: portfolio?.totalBets || 0,
        wins: portfolio?.wins || 0,
        losses: portfolio?.losses || 0,
        profit: portfolio?.totalProfit || 0,
        roi,
      },
    });
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Place bet (manual)
app.post('/api/portfolio/bet', (req, res) => {
  try {
    const { matchId, betType, stakeSize, odds } = req.body;

    const result = db
      .prepare(`
        INSERT INTO portfolio (matchId, betType, stakeSize, odds, result)
        VALUES (?, ?, ?, ?, 'PENDING')
      `)
      .run(matchId, betType, stakeSize, odds);

    res.json({
      success: true,
      betId: result.lastInsertRowid,
    });
  } catch (error) {
    console.error('Error placing bet:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: Manual trigger for predictions
app.post('/api/admin/update-predictions', (req, res) => {
  // TODO: Add API key validation
  updatePredictions()
    .then((summary) => {
      res.json({ success: true, summary });
    })
    .catch((error) => {
      res.status(500).json({ success: false, error: error.message });
    });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Scheduled Jobs

// Update predictions daily at 6 AM and 2 PM
cron.schedule('0 6,14 * * *', () => {
  console.log('Running scheduled prediction update...');
  updatePredictions().catch((error) => {
    console.error('Scheduled update failed:', error);
  });
});

// Update every 6 hours for live odds updates
cron.schedule('0 */6 * * *', () => {
  console.log('Running 6-hour odds update...');
  updatePredictions().catch((error) => {
    console.error('6-hour update failed:', error);
  });
});

// Cleanup old predictions (keep last 30 days)
cron.schedule('0 3 * * *', () => {
  console.log('Running cleanup job...');
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
  db.prepare('DELETE FROM matches WHERE date < ?').run(thirtyDaysAgo);
  console.log('Cleanup complete');
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🎾 Tennis Betting Server running on http://localhost:${PORT}`);
  console.log(`📊 API Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`🔄 Scheduled jobs: 6 AM & 2 PM daily updates\n`);

  initializeDatabase();

  // Run initial prediction update
  updatePredictions().catch((error) => {
    console.error('Initial prediction failed:', error);
  });
});

module.exports = app;
