# Fan Fields 2
An INGRESS fan field planner plugin for IITC. Creates a maximum fielded link plan
for a selected set of portals.

Forked from Heistergand

2.2.0 Added multifield feature. 
This splits a single fanfield into multiple sub fields when there are more than 3 outer portals to 
reduce the number of keys required on the single start anchor. If there are only 3 outer portals
there will be no change. Each subfield can be created independently if desired although
this requires some care at the boundaries between sub fields. To do this ignore the provided 
portal order index for any lower numbered portals in other sub fields after creating the
base link for the sub field.
Currently the incoming link reversal control has not been implemented for multi anchor mode
and is disabled until this can be completed (since multiple anchors reduces the start point
keys required this is not as useful as for single anchor mode)


