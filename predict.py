#!/usr/bin/env python3
"""
Python inference wrapper called by Node.js backend
Input: JSON string with match data
Output: JSON with prediction results
"""

import sys
import json
import pickle
import numpy as np
import pandas as pd
from pathlib import Path

# Load trained model
MODEL_PATH = Path(__file__).parent / 'model_weights.pkl'

try:
    with open(MODEL_PATH, 'rb') as f:
        model_data = pickle.load(f)
        ensemble = model_data['ensemble']
        feature_engineer = model_data['feature_engineer']
except FileNotFoundError:
    print(json.dumps({
        'error': 'Model not found. Train model first with train_pipeline.py',
        'probability': 0.5,  # Default to 50/50
    }))
    sys.exit(0)

def predict(match_data):
    """
    Predict match outcome
    
    Input: {
        playerA: string,
        playerB: string,
        surface: string,
        player_a_first_serve_pct: float,
        player_a_first_serve_win_pct: float,
        ... (all 20+ stat fields)
    }
    
    Output: {
        probability: float (0-1),
        confidence: float (0-1),
        model: string
    }
    """
    try:
        # Extract player stats
        player_a_stats = {
            k.replace('player_a_', ''): v
            for k, v in match_data.items()
            if k.startswith('player_a_')
        }
        player_b_stats = {
            k.replace('player_b_', ''): v
            for k, v in match_data.items()
            if k.startswith('player_b_')
        }
        
        # Feature engineering
        feature_set = feature_engineer.engineer_features(
            player_a_stats=player_a_stats,
            player_b_stats=player_b_stats,
            surface=match_data.get('surface', 'Hard'),
            player_a=match_data.get('playerA', 'A'),
            player_b=match_data.get('playerB', 'B')
        )
        
        # Convert to DataFrame
        X = pd.DataFrame([feature_set.features])
        
        # Normalize
        X_norm = feature_engineer.normalize_features(X, fit=False)
        
        # Predict
        proba = ensemble.predict_proba(X_norm)[0]
        
        # Confidence: how certain the model is
        confidence = abs(proba - 0.5) * 2
        
        return {
            'probability': float(proba),
            'confidence': float(confidence),
            'model': 'ensemble',
        }
        
    except Exception as e:
        print(f"Error in prediction: {str(e)}", file=sys.stderr)
        return {
            'probability': 0.5,
            'confidence': 0.0,
            'error': str(e),
        }

if __name__ == '__main__':
    # Read JSON from stdin (passed by Node.js)
    try:
        input_json = sys.stdin.read()
        match_data = json.loads(input_json)
        
        result = predict(match_data)
        print(json.dumps(result))
        
    except json.JSONDecodeError as e:
        print(json.dumps({
            'error': f'Invalid JSON: {str(e)}',
            'probability': 0.5,
        }))
    except Exception as e:
        print(json.dumps({
            'error': str(e),
            'probability': 0.5,
        }))
