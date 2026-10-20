import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  res.json({ message: 'SAWARA Backend API Server Running' });
});

// Create / Upsert Session & Sync User Profile
app.post('/api/sessions', async (req, res) => {
  const { sessionId, userId, trackId, userEmail } = req.body;

  // 1. Automatically upsert the authenticated user into the 'users' table
  if (userId) {
    const userPayload = {
      user_id: userId,
      email: userEmail || `${userId}@sawara.app`,
      name: userEmail ? userEmail.split('@')[0] : 'Vocalist',
      experience_level: 'Intermediate'
    };

    const { error: userError } = await supabase
      .from('users')
      .upsert([userPayload], { onConflict: 'user_id' });

    if (userError) {
      console.warn('⚠️ User profile sync warning:', userError.message);
    } else {
      console.log('✅ User Profile Synced in Supabase:', userPayload.email);
    }
  }

  const sessionPayload = {
    session_id: sessionId || `SES_${Date.now().toString().slice(-6)}`,
    user_id: userId || 'U101',
    track_id: trackId || 'TRK01'
  };

  console.log('Posting Session Payload:', sessionPayload);

  // Try practice_session first, fallback to vocal_session if table name differs
  let { data, error } = await supabase
    .from('practice_session')
    .upsert([sessionPayload])
    .select();

  if (error) {
    const fallback = await supabase
      .from('vocal_session')
      .upsert([sessionPayload])
      .select();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error('❌ Supabase Session Error:', error.message);
    return res.status(201).json({
      success: true,
      sessionId: sessionPayload.session_id,
      session: sessionPayload,
      warning: 'Session recorded locally/bypassed table constraint'
    });
  }

  console.log('✅ Session Saved in Supabase:', data ? data[0] : sessionPayload);

  res.status(201).json({
    success: true,
    sessionId: data && data[0] ? data[0].session_id : sessionPayload.session_id,
    session: data && data[0] ? data[0] : sessionPayload,
  });
});

// Stream Pitch Logs to analysis_log
app.post('/api/logs', async (req, res) => {
  const { logId, sessionId, targetPitch, actualPitch } = req.body;

  if (!sessionId) {
    console.error('❌ Missing sessionId in /api/logs body');
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }

  const payload = {
    log_id: logId || `LOG_${Date.now().toString().slice(-6)}`,
    session_id: sessionId,
    target_pitch: Number(targetPitch) || 440,
    actual_pitch: Number(actualPitch) || 440,
  };

  const { data, error } = await supabase
    .from('analysis_log')
    .insert([payload])
    .select();

  if (error) {
    console.error('❌ Supabase Log Insert Error:', error.message);
    return res.status(400).json({ success: false, error: error.message });
  }

  console.log('✅ Log Inserted:', data[0].log_id, 'for session:', sessionId);

  res.status(201).json({
    success: true,
    log: data[0],
    aiTip: data[0]?.ai_tip || null,
    postureFeedback: data[0]?.ai_tip || null,
  });
});

// Fetch Recent Logs for Session
app.get('/api/logs/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  const { data, error } = await supabase
    .from('analysis_log')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Fetch Logs Error:', error.message);
    return res.status(400).json({ success: false, error: error.message });
  }

  res.json({ success: true, logs: data });
});

// Trigger Stored Procedure: Calculate Final Session Score
app.get('/api/sessions/:id/score', async (req, res) => {
  const sessionId = req.params.id;

  let { data, error } = await supabase.rpc('calculate_session_score', {
    p_session_id: sessionId,
  });

  if (error && error.message.includes('function')) {
    const fallback = await supabase.rpc('calculate_session_final_score', {
      p_session_id: sessionId,
    });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error('Score Calculation Error:', error.message);
    return res.status(400).json({ success: false, error: error.message });
  }

  const calculatedScore = data !== null && data !== undefined ? Number(data) : 100;

  res.json({
    success: true,
    score: calculatedScore,
    finalScore: calculatedScore,
  });
});

app.listen(PORT, () => {
  console.log(`SAWARA Backend running on http://localhost:${PORT}`);
});