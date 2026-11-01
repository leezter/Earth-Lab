# Preserved mobility-v9.3

This folder retains the v9.3 freeze, the parking compiler changed in v9.4,
and prior verification reports. Unchanged frozen inputs remain at the paths
listed in the freeze. Existing v9.3 jobs, failures, logs and playable tiles
remain in `../custom/` with their original IDs.

Version 9.3 could compile enclosed parking as a ground surface, after which
the independent validation correctly refused the scene. Version 9.4 omits
those unsupported parking surfaces before rendering and records provenance;
it does not add layered parking simulation or relax publication validation.
