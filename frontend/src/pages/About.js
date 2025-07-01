import React, { useState, useEffect } from 'react';
import axios from 'axios';

function About() {
  const [versionInfo, setVersionInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVersionInfo = async () => {
      try {
        // Try to get from environment variable first (for development)
        const envCommit = process.env.REACT_APP_GIT_COMMIT;
        
        if (envCommit && envCommit !== 'unknown') {
          setVersionInfo({
            git_commit: envCommit,
          });
          setLoading(false);
          return;
        }

        // Fallback to API call (for production)
        const response = await axios.get('/api/version');
        if (response.data.success) {
          setVersionInfo(response.data.data);
        }
      } catch (error) {
        console.error('Failed to fetch version info:', error);
        // Set fallback info
        setVersionInfo({
          git_commit: 'unknown',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchVersionInfo();
  }, []);

  const formatCommitHash = (hash) => {
    if (!hash || hash === 'unknown') return 'Unknown';
    return hash.length > 8 ? hash.substring(0, 8) : hash;
  };

  return (
    <div className="page-container">
      <h1>About Us</h1>
      <p>This is the about page of our application.</p>
      
      <div className="version-info" style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
        <h3>Version Information</h3>
        {loading ? (
          <p>Loading version information...</p>
        ) : (
          <div>
            <p><strong>Version:</strong> {versionInfo?.version || 'Unknown'}</p>
            <p><strong>Commit:</strong> {formatCommitHash(versionInfo?.git_commit)}</p>
            {versionInfo?.git_commit && versionInfo.git_commit !== 'unknown' && (
              <p style={{ fontSize: '0.8rem', color: '#666' }}>
                Full commit hash: <code>{versionInfo.git_commit}</code>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default About;