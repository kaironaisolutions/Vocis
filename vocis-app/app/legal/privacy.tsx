import React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing } from '../../src/constants/theme';

export default function PrivacyPolicyScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>Privacy Policy</Text>
      <Text style={styles.updated}>Last updated: April 2026</Text>

      <Text style={styles.heading}>1. Data Controller</Text>
      <Text style={styles.body}>
        Vocis ("we", "us", "our") is the data controller for this application.
        For privacy inquiries, contact us at privacy@vocisapp.com.
      </Text>

      <Text style={styles.heading}>2. Data We Collect</Text>
      <Text style={styles.body}>
        Vocis v1.0 does not collect, store, or transmit any personal data to our
        servers. Specifically:{'\n\n'}
        - No name, email, account, or personal information is collected{'\n'}
        - No analytics, advertising, or tracking SDKs are included{'\n'}
        - No data is sent to any server other than ElevenLabs for speech processing{'\n'}
        - All inventory data is stored locally on your device in encrypted storage
      </Text>

      <Text style={styles.heading}>3. Voice Audio Processing</Text>
      <Text style={styles.body}>
        When you use the voice recording feature, audio is streamed in real-time
        to ElevenLabs Inc. for speech-to-text transcription. Important details:{'\n\n'}
        - Audio is streamed directly and never saved as a file on your device{'\n'}
        - ElevenLabs processes audio in zero-retention mode — audio is not stored
        by ElevenLabs after processing{'\n'}
        - Only the resulting text transcript is retained locally on your device{'\n\n'}
        For more information about how ElevenLabs handles data, see their privacy
        policy at elevenlabs.io/privacy.
      </Text>

      <Text style={styles.heading}>4. Data Storage</Text>
      <Text style={styles.body}>
        All session and inventory data is stored exclusively on your device using
        encrypted SQLite storage (SQLCipher). Data never leaves your device unless
        you explicitly export it via the CSV export feature.
      </Text>

      <Text style={styles.heading}>5. Data Export</Text>
      <Text style={styles.body}>
        When you export inventory data as CSV, the file is generated on your device
        and delivered via the method you choose (email, download, or share). We do
        not receive or process exported files.
      </Text>

      <Text style={styles.heading}>6. Your Rights</Text>
      <Text style={styles.body}>
        Under GDPR, CCPA, and similar regulations, you have the right to:{'\n\n'}
        - Access: View all data stored by the app (visible in session history){'\n'}
        - Erasure: Delete individual sessions or all data via Settings{'\n'}
        - Portability: Export your data as CSV at any time{'\n'}
        - Restriction: You may stop using the app and delete all local data at any time{'\n\n'}
        Since all data is stored locally on your device and we have no server-side
        data, exercising these rights is fully within your control.
      </Text>

      <Text style={styles.heading}>7. Children's Privacy</Text>
      <Text style={styles.body}>
        Vocis is not directed at children under 13. We do not knowingly collect
        information from children. This app is designed for business use by
        vintage shop owners and resellers.
      </Text>

      <Text style={styles.heading}>8. Third-Party Services</Text>
      <Text style={styles.body}>
        The only third-party service used by Vocis is:{'\n\n'}
        - ElevenLabs Inc. — Speech-to-text processing (zero-retention mode){'\n\n'}
        No analytics, advertising, or social media SDKs are included in v1.0.
      </Text>

      <Text style={styles.heading}>9. Data Retention</Text>
      <Text style={styles.body}>
        All data is stored locally on your device. You control retention via:{'\n\n'}
        - Auto-purge: Sessions older than 90 days are automatically deleted (configurable in Settings){'\n'}
        - Manual deletion: Delete individual sessions or all data at any time via Settings{'\n'}
        - App uninstall: Removing the app deletes all associated data
      </Text>

      <Text style={styles.heading}>10. Changes to This Policy</Text>
      <Text style={styles.body}>
        We may update this Privacy Policy from time to time. Changes will be
        reflected in the "Last updated" date above and in app updates. Continued
        use of the app after changes constitutes acceptance.
      </Text>

      <Text style={styles.heading}>11. Contact</Text>
      <Text style={styles.body}>
        For privacy inquiries or to exercise your data rights, contact:{'\n\n'}
        Email: privacy@vocisapp.com{'\n'}
        Web: vocisapp.com/support
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  title: {
    ...Typography.heading1,
    marginBottom: Spacing.xs,
  },
  updated: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
    marginBottom: Spacing.xl,
  },
  heading: {
    ...Typography.heading3,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  body: {
    ...Typography.body,
    color: Colors.textSecondary,
    lineHeight: 24,
  },
});
