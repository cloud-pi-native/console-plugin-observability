# C'est quoi ?
Ceci est un plugin additionnel pour la console [Cloud-Pi-Native](https://github.com/cloud-pi-native/console)

Il permet :
- d'alimenter un fichier de values qui pilote la création d'instance Grafana et de ses datasources (prometheus, alert-manager, loki)
- de propager les permissions des utilisateurs via Keycloak

## Usage

Les variables d'environnement suivantes doivent être définies :
- `GRAFANA_URL` : l'URL racine à utiliser pour accéder aux instances déployées pour chaque projet
- `DSO_OBSERVABILITY_CHART_VERSION` : la version du Chart dso-observability à utiliser dans les dépôts de dashboards et alertes projet.
