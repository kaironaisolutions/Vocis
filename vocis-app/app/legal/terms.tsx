import React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing } from '../../src/constants/theme';

export default function TermsOfServiceScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>Terms of Service</Text>
      <Text style={styles.updated}>Last updated: April 2026</Text>

      <Text style={styles.heading}>1. Acceptance of Terms</Text>
      <Text style={styles.body}>
        By downloading, installing, or using Vocis ("the App"), you agree to be
        bound by these Terms of Service. If you do not agree, do not use the App.
      </Text>

      <Text style={styles.heading}>2. Description of Service</Text>
      <Text style={styles.body}>
        Vocis is a voice-to-inventory mobile application that enables users to
        create inventory records using voice input. The App transcribes spoken
        descriptions into structured data and generates CSV exports in multiple
        formats compatible with spreadsheet software, Shopify, eBay, and Depop.
      </Text>

      <Text style={styles.heading}>3. User Responsibilities</Text>
      <Text style={styles.body}>
        - You own all inventory data you create using the App{'\n'}
        - You are responsible for the accuracy of your exported data{'\n'}
        - You are responsible for reviewing transcribed items before export{'\n'}
        - You are responsible for safeguarding your device and any exported files{'\n'}
        - You must comply with all applicable laws in your jurisdiction when using the App
      </Text>

      <Text style={styles.heading}>4. Third-Party Services</Text>
      <Text style={styles.body}>
        Voice audio is processed by ElevenLabs Inc. for speech-to-text
        transcription. By using the voice recording feature, you acknowledge
        that audio data is transmitted to ElevenLabs for processing. ElevenLabs
        operates in zero-retention mode — audio is not stored after processing.{'\n\n'}
        For ElevenLabs' terms and privacy practices, visit:{'\n'}
        elevenlabs.io/terms{'\n'}
        elevenlabs.io/privacy
      </Text>

      <Text style={styles.heading}>5. No Warranty</Text>
      <Text style={styles.body}>
        THE APP IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. Speech-to-text
        transcription is AI-generated and may contain errors. Transcriptions may
        be inaccurate, especially in noisy environments or with uncommon
        vocabulary. You must review all items before exporting.{'\n\n'}
        We do not guarantee:{'\n'}
        - Accuracy of speech transcription{'\n'}
        - Continuous, uninterrupted availability of the service{'\n'}
        - Compatibility with all devices or operating system versions
      </Text>

      <Text style={styles.heading}>6. Limitation of Liability</Text>
      <Text style={styles.body}>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, VOCIS AND ITS DEVELOPERS SHALL
        NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
        PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:{'\n\n'}
        - Loss of profits or revenue{'\n'}
        - Inventory errors arising from transcription inaccuracies{'\n'}
        - Data loss due to device failure or app malfunction{'\n'}
        - Unauthorized access to data on compromised devices{'\n\n'}
        Our total liability shall not exceed the amount you paid for the App.
      </Text>

      <Text style={styles.heading}>7. Intellectual Property</Text>
      <Text style={styles.body}>
        The Vocis name, logo, and application code are proprietary. Brand names
        that appear in inventory entries (e.g., clothing brand names) are
        user-generated content and remain the trademarks of their respective
        owners. The App does not claim any affiliation with or endorsement by
        any third-party brands.
      </Text>

      <Text style={styles.heading}>8. API Key Usage</Text>
      <Text style={styles.body}>
        You are responsible for your ElevenLabs API key. You must:{'\n\n'}
        - Keep your API key confidential{'\n'}
        - Not share your API key with others{'\n'}
        - Monitor your API usage and billing{'\n'}
        - Comply with ElevenLabs' terms of service
      </Text>

      <Text style={styles.heading}>9. Termination</Text>
      <Text style={styles.body}>
        You may stop using the App at any time by uninstalling it. Uninstalling
        deletes all local data. We reserve the right to modify or discontinue
        the App at any time without notice.
      </Text>

      <Text style={styles.heading}>10. Governing Law</Text>
      <Text style={styles.body}>
        These Terms shall be governed by and construed in accordance with the
        laws of the jurisdiction in which the App developer is based, without
        regard to conflict of law principles.
      </Text>

      <Text style={styles.heading}>11. Changes to Terms</Text>
      <Text style={styles.body}>
        We may update these Terms from time to time. Changes will be reflected
        in the "Last updated" date above. Continued use of the App after
        changes constitutes acceptance of the revised Terms.
      </Text>

      <Text style={styles.heading}>12. Contact</Text>
      <Text style={styles.body}>
        For questions about these Terms, contact:{'\n\n'}
        Email: legal@vocisapp.com{'\n'}
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
