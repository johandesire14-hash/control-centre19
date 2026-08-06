import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

function Section({ title, children }: { title: string; children: string }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>{children}</Text>
    </View>
  );
}

export default function PrivacyScreen() {
  const colors = useColors();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.updated, { color: colors.mutedForeground }]}>
        Dernière mise à jour : juillet 2025
      </Text>

      <Section title="1. Responsable du traitement">
        {`WapiGarage SAS est responsable du traitement de vos données personnelles collectées via l'application mobile WapiGarage.\n\nContact : support@wapigarage.cg`}
      </Section>

      <Section title="2. Données collectées">
        {`Nous collectons les données suivantes :\n\n• Données d'identification : prénom, nom, adresse e-mail, photo de profil (via Google)\n• Données de contact : numéro de téléphone (facultatif)\n• Données d'utilisation : garages consultés, avis publiés, conversations\n• Données techniques : identifiant de session, logs d'utilisation\n\nNous ne collectons jamais vos données de localisation sans votre consentement explicite.`}
      </Section>

      <Section title="3. Finalités du traitement">
        {`Vos données sont utilisées pour :\n• Créer et gérer votre compte utilisateur\n• Permettre la mise en relation avec les garages\n• Afficher votre historique de conversations et avis\n• Améliorer nos services et détecter les abus\n• Vous envoyer des notifications si vous y avez consenti`}
      </Section>

      <Section title="4. Base légale">
        {`Le traitement de vos données repose sur :\n• L'exécution du contrat (fourniture du service)\n• Votre consentement (notifications, données facultatives)\n• Notre intérêt légitime (sécurité, amélioration du service)`}
      </Section>

      <Section title="5. Partage des données">
        {`Vos données ne sont pas vendues à des tiers. Elles peuvent être partagées avec :\n• Les garages avec lesquels vous entrez en contact (nom, messages)\n• Nos prestataires techniques (hébergement, infrastructure)\n• Les autorités compétentes en cas d'obligation légale`}
      </Section>

      <Section title="6. Conservation">
        {`Vos données sont conservées pendant la durée de votre inscription, puis supprimées dans un délai de 30 jours suivant la clôture de votre compte.\n\nLes données de journalisation sont conservées 12 mois à des fins de sécurité.`}
      </Section>

      <Section title="7. Vos droits">
        {`Conformément à la réglementation en vigueur, vous disposez des droits suivants :\n• Accès à vos données\n• Rectification de vos données\n• Suppression de votre compte et de vos données\n• Opposition au traitement\n• Portabilité de vos données\n\nPour exercer ces droits, contactez-nous à support@wapigarage.cg.`}
      </Section>

      <Section title="8. Sécurité">
        {`Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour protéger vos données contre tout accès non autorisé, perte ou divulgation (chiffrement des communications, sessions sécurisées, accès restreints).`}
      </Section>

      <Section title="9. Modifications">
        {`Nous pouvons modifier cette politique à tout moment. En cas de changement important, vous serez notifié(e) dans l'application. La poursuite de l'utilisation après notification vaut acceptation.`}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60 },
  updated: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginBottom: 24,
  },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    marginBottom: 8,
  },
  body: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 22,
  },
});
