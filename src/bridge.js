const identity = require('./identity');

/**
 * ===========================================================================
 *  BRÜCKE – Plattform-IDs in Welt und Konto übersetzen
 * ===========================================================================
 *
 * Die Spiellogik und alle Ansichten lesen `interaction.guildId` und
 * `interaction.user.id`. Für die Cross-Progression müssen dort aber die
 * **Welt** und das **kanonische Konto** stehen (siehe identity.js).
 *
 * Statt hunderte Fundstellen anzufassen, wird das Interaction hier einmal
 * umhüllt: Lesezugriffe auf `guildId`/`user.id` liefern die übersetzten Werte,
 * alles andere bleibt unverändert.
 *
 * Wichtig: Methoden werden an das **echte** Objekt gebunden. discord.js nutzt
 * private Felder – würde eine Methode mit der Hülle als `this` laufen, bräche
 * sie. Deshalb `bind(target)`.
 */

/** Legt eine Hülle um ein Discord-Interaction. */
function wrap(interaction, platform = 'discord') {
  const world = identity.world();
  const accountId = identity.account(platform, interaction.user.id);

  // Anzeigename merken – Fluxer kann Discord-Erwähnungen nicht auflösen und
  // zeigt stattdessen den Namen.
  identity.remember(accountId, interaction.user.displayName ?? interaction.user.username);

  const userProxy = new Proxy(interaction.user, {
    get(target, prop, receiver) {
      if (prop === 'id') return accountId;
      if (prop === 'platformId') return interaction.user.id;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return new Proxy(interaction, {
    get(target, prop) {
      if (prop === 'guildId') return world;
      if (prop === 'user') return userProxy;
      if (prop === 'platform') return platform;
      if (prop === 'platformGuildId') return target.guildId;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

module.exports = { wrap };
