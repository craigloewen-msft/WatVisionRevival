import React, { useState, useEffect } from 'react';
import axios from 'axios';

function About() {
  const [versionInfo, setVersionInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVersionInfo = async () => {
      try {
        const response = await axios.get('/api/version');
        if (response.data.success) {
          setVersionInfo(response.data.data);
        }
      } catch (error) {
        console.error('Failed to fetch version info:', error);
        // Set fallback info
        setVersionInfo({
          git_commit: 'Received error from API',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchVersionInfo();
  }, []);

  return (
    <div className="page-container">
      <h1>About Us</h1>
      <p>This is the about page of our application!</p>
      
      <div className="version-info">
        <h3>Version Information</h3>
        {loading ? (
          <p>Loading version information...</p>
        ) : (
          <div>
            {versionInfo?.git_commit && (
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