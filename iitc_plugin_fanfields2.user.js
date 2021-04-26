// ==UserScript==
// @id              fanfields@heistergand
// @name            IITC plugin: Fan Fields 2
// @author          Heistergand
// @category        Layer
// @version         2.1.10.2
// @description     Generate a link plan to create the maximum number fields from a group of portals. Enable from the layer chooser.
// @include         https://intel.ingress.com/*
// @match           https://intel.ingress.com/*
// @grant           none
// @downloadURL https://github.com/Heistergand/fanfields2/raw/master/iitc_plugin_fanfields2.user.js
// @updateURL https://github.com/Heistergand/fanfields2/raw/master/iitc_plugin_fanfields2.meta.js
// ==/UserScript==

/*
  Forked from Heistergand, with contributions from Seth10 and bryane50
*/

/*
Version History:
2.1.10
Bug fix: Move leaflet related init into setup() 

2.1.9.1 (zysfryar)
Fixed blank in header for compatibility with IITC-CE Button.

2.1.9 (bryane50)
Fix for missing constants in leaflet verion 1.6.0. 

2.1.8 (bryane50)
Added starting portal advance button to select among the list of
perimeter portals.

2.1.7 (bryane50)
Removed marker and random selection of starting point portal. Replaced
with use of first outer hull portal. This ensures maximum fields will
be generated.

2.1.5 (Seth10)
FIX: Minor syntax issue affecting potentially more strict runtimes

2.1.4 (Seth10)
FIX: Make the clockwise button change its label to "Counterclockwise" when toggled

2.1.3 (Heistergand)
FIX: added id tags to menu button elements, ...just because.

2.1.2
FIX: Minor issues

2.1.1
FIX: changed List export format to display as a table

2.1.0
NEW: Added save to DrawTools functionality
NEW: Added fanfield statistics
FIX: Changed some menu texts
VER: Increased Minor Version due to DrawTools Milestone

2.0.9
NEW: Added the number of outgoing links to the simple list export

2.0.8
NEW: Toggle the direction of the star-links (Inbound/Outbound) and calculate number of SBUL
FIX: Despite crosslinks, respecting the current intel did not handle done links

2.0.7
FIX: Sorting of the portals was not accurate for far distance anchors when the angle was too equal.
NEW: Added option to respect current intel and not crossing lines.

2.0.6
FIX: Plan messed up on multiple polygons.

2.0.5
FIX: fan links abandoned when Marker was outside the polygon
BUG: Issue found where plan messes up when using more than one polygon (fixed in 2.0.6)

2.0.4
NEW: Added Lock/Unlock button to freeze the plan and prevent recalculation on any events.
NEW: Added a simple text export (in a dialog box)
FIX: Several changes to the algorithm
BUG: Issue found where links are closing fields on top of portals that are
     successors in the list once you got around the startportal

2.0.3
FIX: Counterclockwise did not work properly
NEW: Save as Bookmarks

2.0.2
NEW: Added Menu
NEW: Added counterclockwise option
FIX: Minor Bugfixes

2.0.1
NEW: Count keys to farm
NEW: Count total fields
NEW: Added labels to portals
FIX: Links were drawn in random order
FIX: Only fields to the center portal were drawn

Todo:

Add a kind of system to have a cluster of Fanfields
Calculate distance to walk for the plan (crow / streets)
Calculate the most efficient possible plan based on ways to walk and keys to farm
Export to Arcs
Export to Tasks
Bookmarks saving works, but let it also save into a Bookmarks Folder
Calculate amount of possible rebuilds after flipping the center portal
Click on a link to flip it's direction

*/



function wrapper(plugin_info) {
    // ensure plugin framework is there, even if iitc is not yet loaded
    if(typeof window.plugin !== 'function') window.plugin = function() {};

    // PLUGIN START ////////////////////////////////////////////////////////

    // use own namespace for plugin
    window.plugin.fanfields = function() {};
    var thisplugin = window.plugin.fanfields;

    // const values
    // zoom level used for projecting points between latLng and pixel coordinates. may affect precision of triangulation
    thisplugin.PROJECT_ZOOM = 16;

    thisplugin.LABEL_WIDTH = 100;
    thisplugin.LABEL_HEIGHT = 49;

    // constants no longer present in leaflet 1.6.0
    thisplugin.DEG_TO_RAD = Math.PI / 180;
    thisplugin.RAD_TO_DEG = 180 / Math.PI;

    thisplugin.labelLayers = {};

    thisplugin.start = {guid:undefined, point : {}, index : undefined}; //undefined;

    thisplugin.locations = [];
    thisplugin.fanpoints = [];
    thisplugin.sortedFanpoints = [];
    thisplugin.sortedFanpoints[0] = [];
    thisplugin.sfLinks = [];
    thisplugin.hullPoints = [];
    thisplugin.numSubFields = 1;
    thisplugin.labels = [];

    thisplugin.links = [];
    thisplugin.linksLayerGroup = null;
    thisplugin.fieldsLayerGroup = null;
    thisplugin.numbersLayerGroup = null;

    thisplugin.saveBookmarks = function() {

        // loop thru portals and UN-Select them for bkmrks
        var bkmrkData, list;

        for (guid of Object.keys(thisplugin.fanpoints)) {

            bkmrkData = window.plugin.bookmarks.findByGuid(guid);
            if(bkmrkData) {

                list = window.plugin.bookmarks.bkmrksObj.portals;

                delete list[bkmrkData.id_folder].bkmrk[bkmrkData.id_bookmark];

                $('.bkmrk#'+bkmrkData.id_bookmark + '').remove();

                window.plugin.bookmarks.saveStorage();
                window.plugin.bookmarks.updateStarPortal();

                window.runHooks('pluginBkmrksEdit', {"target": "portal", "action": "remove", "folder": bkmrkData.id_folder, "id": bkmrkData.id_bookmark, "guid":guid});

                console.log('BOOKMARKS via FANFIELDS: removed portal ('+bkmrkData.id_bookmark+' situated in '+bkmrkData.id_folder+' folder)');
            }
        };
        // loop again: ordered(!) to add them as bookmarks
        for (guid of Object.keys(thisplugin.fanpoints)) {

            var p = window.portals[guid];
            var ll = p.getLatLng();

            plugin.bookmarks.addPortalBookmark(guid, ll.lat+','+ll.lng, p.options.data.title);

        };

    };

    // cycle to next starting point on the convex hull list of portals
    thisplugin.nextstartPoint = function() {
        if (!thisplugin.is_locked) {
            // *** startPoint handling is duplicated in updateLayer().
            var i = thisplugin.start.index + 1;
            if (i >= thisplugin.hullPoints.length) {
                i = 0;
            }
            
            thisplugin.start.index = i;

            thisplugin.start.guid = thisplugin.hullPoints[thisplugin.start.index][0];
            thisplugin.start.point = this.fanpoints[thisplugin.start.guid];
            // *** full behaviour of updateLayer is not needed here
            //     could split updateLayer into separate scanning and field creation sections
            thisplugin.updateLayer();
    	}

    };

    thisplugin.generateTasks = function() {};
    thisplugin.reset = function() {};
    thisplugin.help = function() {
        dialog({
            html: '<p>Draw a polygon with Drawtools around a cluster of portals to be fielded. More than one polygon can be used if needed. You must remove existing polygons if they cover portals you do not want to use.'+

            '<p>Use the Lock function to prevent the script from recalculating anything. This is useful if you have a large area and want to zoom into details.</p>  '+
            '<p><i>Move Start</i> changes the start portal to the next boundary portal.'+
            '<i>Single Anchor/Multi Anchor</i> toggles between 1 anchor for all portals and multiple anchors to reduce the keys needed at the single anchor, but will increase keys required for other portals.'+
            '<p>Export your fanfield portals to bookmarks to extend your possibilites to work with the information.</p>'+
            '<p>To create the field plan follow the portal numbers from 1 to the highest where Start is at 0. At each portal link from '+
            'the current portal to all linkable lower numbered portals in numeric order.'+
            'For example: link 1->Start, link 2->Start, link 2->1, ...</p>'+
            // To do : find out if impossible link issue still exists
            /*'<p>There are some known issues you should be aware of:<br>This script uses a simple method to check for crosslinks. '+
            'It may suggest links that are not possible in dense areas because <i>that last portal</i> is in the way. It means they have flipped order. '+
            'If you\'re not sure, link to the center for both portals first and see what you can link. You\'ll get the same amount of fields, but need to farm other keys.</p>'+
            */
            '',
            id: 'plugin_fanfields_alert_help',
            title: 'Fan Fields - Help',
            width: 650,
            closeOnEscape: true
        });

    };

    // *** To do : Fix this to use multifield plan data
    thisplugin.showStatistics = function() {
        var text = "";
        let nportals = Object.keys(thisplugin.fanpoints).length;
        let nlinks = 0;

        console.log('labels:', thisplugin.labels);
        for (p of Object.keys(thisplugin.labels)) {
            nlinks += thisplugin.labels[p].links;
        }

        text = "<table><tr><td>Total portals:</td><td>" + nportals.toString() + "</td><tr>" +
            //"<tr><td>Total links / keys:</td><td>" + thisplugin.donelinks.length.toString() +"</td><tr>" +
            "<tr><td>Total links:</td><td>" + nlinks.toString() +"</td><tr>" +
            "<tr><td>Fields:</td><td>" + thisplugin.triangles.length.toString() +"</td><tr>" +
            //"<tr><td>Build AP (links and fields):</td><td>" + (thisplugin.donelinks.length*313 + thisplugin.triangles.length*1250).toString() +"</td><tr>" +
            "</table>";
        dialog({
            html: text,
            id: 'plugin_fanfields_alert_statistics',
            title: '== Fan Field Statistics == ',
            // width: 500,
            closeOnEscape: true
        });

    }

    thisplugin.exportDrawtools = function() {
        // todo: currently the link plan added to the DrawTools Layer. We need to replace existing
        // drawn links and how about just exporting the json without saving it to the current draw?

        // *** this exports geodesicPolyline; drawLink is using polyline
        var alatlng, blatlng, layer;
        thisplugin.sfLinks.forEach(function(sf){
            sf.forEach(function(l) {
                alatlng = [window.portals[l.a.guid]._latlng.lat, window.portals[l.a.guid]._latlng.lng];
                blatlng = [window.portals[l.b.guid]._latlng.lat, window.portals[l.b.guid]._latlng.lng];
                layer = L.geodesicPolyline([alatlng, blatlng], window.plugin.drawTools.lineOptions);
                window.plugin.drawTools.drawnItems.addLayer(layer);
                // remove save so the drawn items do not persist
                //window.plugin.drawTools.save();
            });
        });
    }

    thisplugin.exportArcs = function() {
        //todo...
    }

    thisplugin.exportTasks = function() {
        //todo...
    }

    // To do : Add export refresh on updateLayer: On desktop the menu is active and can change the plan
    // while text dialog is open, but the dialog does not update.
    thisplugin.exportText = function() {
        var text = "<table><thead><tr><th style='text-align:right'>Pos </th><th style='text-align:left'>Portal Name</th><th>Keys</th><th>Links</th></tr></thead><tbody>";

        for (p of Object.keys(thisplugin.labels)) { 
            let portal = window.portals[p];
            let title = "unknown title";
            if (portal !== undefined) {
                title = portal.options.data.title;
            }
            let index = thisplugin.labels[p].index.toString();
            let keys = thisplugin.labels[p].keys.toString();
            let links = thisplugin.labels[p].links.toString();
            text+='<tr><td>' + index + '</td><td>'+ title + '</td><td>' + keys + '</td><td>' + links + '</td></tr>';
        };

        text+='</tbody></table>';
        dialog({
            html: text,
            id: 'plugin_fanfields_alert_textExport',
            title: 'Fan Fields',
            width: 500,
            closeOnEscape: true
        });

    };
    thisplugin.respectCurrentLinks = false;
    thisplugin.toggleRespectCurrentLinks = function() {
        thisplugin.respectCurrentLinks = !thisplugin.respectCurrentLinks;
        if (thisplugin.respectCurrentLinks) {
            $('#plugin_fanfields_respectbtn').html('Respect&nbsp;Intel:&nbsp;ON');
        } else {
            $('#plugin_fanfields_respectbtn').html('Respect&nbsp;Intel:&nbsp;OFF');
        }
        thisplugin.delayedUpdateLayer(0.2);
    };
    thisplugin.is_locked = false;
    thisplugin.lock = function() {
        thisplugin.is_locked = !thisplugin.is_locked;
        if (thisplugin.is_locked) {
            $('#plugin_fanfields_lockbtn').html('Locked'); // &#128274;
        } else {
            $('#plugin_fanfields_lockbtn').html('Unlocked'); // &#128275;
        }
    };

    thisplugin.is_clockwise = true;
    thisplugin.toggleclockwise = function() {
        thisplugin.is_clockwise = !thisplugin.is_clockwise;
        var clockwiseSymbol="", clockwiseWord="";
        if (thisplugin.is_clockwise)
            clockwiseSymbol = "&#8635;", clockwiseWord = "Clockwise";
        else
            clockwiseSymbol = "&#8634;", clockwiseWord = "Counterclockwise";
        $('#plugin_fanfields_clckwsbtn').html(clockwiseWord+':&nbsp;('+clockwiseSymbol+')');
        thisplugin.delayedUpdateLayer(0.2);
    };

    thisplugin.multiField = false;
    thisplugin.toggleMultiField = function() {
        thisplugin.multiField = !thisplugin.multiField;
        let text = "";
        if (thisplugin.multiField) {
            text = "Multi Anchor";
        }
        else {
            text = "Single Anchor";
        }
        $('#plugin_fanfields_mfbtn').html(text);
        thisplugin.delayedUpdateLayer(0.2);

    };

    thisplugin.starDirENUM = {CENTRALIZING:-1, RADIATING: 1};
    thisplugin.stardirection = thisplugin.starDirENUM.CENTRALIZING;

    thisplugin.toggleStarDirection = function() {
        thisplugin.stardirection *= -1;
        var html = "outbounding";

        if (thisplugin.stardirection == thisplugin.starDirENUM.CENTRALIZING) {
            html = "inbounding";
        }

        $('#plugin_fanfields_stardirbtn').html(html);
        thisplugin.delayedUpdateLayer(0.2);
    };



    thisplugin.setupCSS = function() {
        $("<style>").prop("type", "text/css").html('.plugin_fanfields_btn {margin-left:2px;margin-right:6px;}' +

                                                   '.plugin_fanfields{' +
                                                   'color: #FFFFBB;' +
                                                   'font-size: 11px;'+
                                                   'line-height: 13px;' +
                                                   'text-align: left;'+
                                                   'vertical-align: bottom;'+
                                                   'padding: 2px;' +
                                                   'padding-top: 15px;' +
                                                   'overflow: hidden;' +
                                                   'text-shadow: 1px 1px #000, 1px -1px #000, -1px 1px #000, -1px -1px #000, 0 0 5px #000;' +
                                                   'pointer-events: none;' +


                                                   'width: ' + thisplugin.LABEL_WIDTH + 'px;'+
                                                   'height: '+ thisplugin.LABEL_HEIGHT + 'px;'+
                                                   'border-left-color:red; border-left-style: dotted; border-left-width: thin;'+
                                                   //                                                   'border-bottom-color:red; border-bottom-style: dashed; border-bottom-width: thin;'+

                                                   '}' +
                                                   '#plugin_fanfields_toolbox a.highlight { background-color:#ffce00; color:black; font-Weight:bold }'
                                                  ).appendTo("head");


    };

    // find triangles formed in links list by testlink
    //thisplugin.getThirds = function(list, a,b) {
    thisplugin.getThirds = function(list, test) {
        var i,k;
        var linksOnA = [], linksOnB = [], result = [];
        let a = test.a;
        let b = test.b;

        for (i in list) {
            //if ((list[i].a.equals(a) && list[i].b.equals(b)) || (list[i].a.equals(b) && list[i].b.equals(a))) {
            if ((list[i].a.point.equals(a.point) && list[i].b.point.equals(b.point)) || (list[i].a.point.equals(b.point) && list[i].b.point.equals(a.point))) {
                // link in list equals tested link
                // *** test link cannot match existing link, why is this here?
                console.log('getThirds: link matches existing');
                continue;
            }
            
            // find links in list that include point a
            if (list[i].a.point.equals(a.point) || list[i].b.point.equals(a.point))
                linksOnA.push(list[i]);
            // find links in list that include point b
            if (list[i].a.point.equals(b.point) || list[i].b.point.equals(b.point))
                linksOnB.push(list[i]);
        }
        
        for (i in linksOnA) {
            for (k in linksOnB) {
                if (linksOnA[i].a.point.equals(linksOnB[k].a.point) || linksOnA[i].a.point.equals(linksOnB[k].b.point) )
                    result.push(linksOnA[i].a);
                if (linksOnA[i].b.point.equals(linksOnB[k].a.point) || linksOnA[i].b.point.equals(linksOnB[k].b.point))
                    result.push(linksOnA[i].b);
            }
        }
        
        //console.log('get t:', linksOnA, linksOnB);
        console.log('res:', result);
        return result;
    };


    thisplugin.linkExists = function(list, link) {
        var i, result = false;
        for (i in list) {
            if (thisplugin.linksEqual(list[i],link)) {
                result =  true;
                break;
            }
        }
        return result;
    };


    thisplugin.linksEqual = function(link1,link2) {
        var Aa, Ab, Ba, Bb;
        //Aa =  link1.a.equals(link2.a);
        //Ab =  link1.a.equals(link2.b);
        //Ba =  link1.b.equals(link2.a);
        //Bb =  link1.b.equals(link2.b);
        Aa =  link1.a.point.equals(link2.a);
        Ab =  link1.a.point.equals(link2.b);
        Ba =  link1.b.point.equals(link2.a);
        Bb =  link1.b.point.equals(link2.b);
        if ((Aa || Ab) && (Ba || Bb)) {
            return true;
        }
    };


    thisplugin.intersects = function(link1, link2) {
        /* Todo:
        Change vars to meet original links
        dGuid,dLatE6,dLngE6,oGuid,oLatE6,oLngE6
        */
        var x1, y1, x2, y2, x3, y3, x4, y4;
        //x1 = link1.a.x;
        //y1 = link1.a.y;
        //x2 = link1.b.x;
        //y2 = link1.b.y;
        //x3 = link2.a.x;
        //y3 = link2.a.y;
        //x4 = link2.b.x;
        //y4 = link2.b.y;
        x1 = link1.a.point.x;
        y1 = link1.a.point.y;
        x2 = link1.b.point.x;
        y2 = link1.b.point.y;
        x3 = link2.a.point.x;
        y3 = link2.a.point.y;
        x4 = link2.b.point.x;
        y4 = link2.b.point.y;
        var Aa, Ab, Ba, Bb;
        //console.log('intersect link1.a:', link1.a);
        //Aa =  link1.a.equals(link2.a);
        //Ab =  link1.a.equals(link2.b);
        //Ba =  link1.b.equals(link2.a);
        //Bb =  link1.b.equals(link2.b);
        Aa =  link1.a.point.equals(link2.a.point);
        Ab =  link1.a.point.equals(link2.b.point);
        Ba =  link1.b.point.equals(link2.a.point);
        Bb =  link1.b.point.equals(link2.b.point);

        if ( Aa || Ab || Ba || Bb)  {
            // intersection is at start, that's ok.
            return false;
        }

        function sameSign(n1, n2) {
            if (n1*n2 > 0) {
                return true;
            } else {
                return false;
            }
        }
        // debugger
        var a1, a2, b1, b2, c1, c2;
        var r1, r2 , r3, r4;
        var denom, offset, num;

        // Compute a1, b1, c1, where link joining points 1 and 2
        // is "a1 x + b1 y + c1 = 0".
        a1 = y2 - y1;
        b1 = x1 - x2;
        c1 = (x2 * y1) - (x1 * y2);

        // Compute r3 and r4.
        r3 = ((a1 * x3) + (b1 * y3) + c1);
        r4 = ((a1 * x4) + (b1 * y4) + c1);

        // Check signs of r3 and r4. If both point 3 and point 4 lie on
        // same side of link 1, the link segments do not intersect.
        if ((r3 !== 0) && (r4 !== 0) && (sameSign(r3, r4))){
            return 0; //return that they do not intersect
        }

        // Compute a2, b2, c2
        a2 = y4 - y3;
        b2 = x3 - x4;
        c2 = (x4 * y3) - (x3 * y4);

        // Compute r1 and r2
        r1 = (a2 * x1) + (b2 * y1) + c2;
        r2 = (a2 * x2) + (b2 * y2) + c2;

        // Check signs of r1 and r2. If both point 1 and point 2 lie
        // on same side of second link segment, the link segments do
        // not intersect.
        if ((r1 !== 0) && (r2 !== 0) && (sameSign(r1, r2))){
            return 0; //return that they do not intersect
        }

        //link segments intersect: compute intersection point.
        denom = (a1 * b2) - (a2 * b1);

        if (denom === 0) {
            return 1; //collinear
        }
        // links_intersect
        return 1; //links intersect, return true
    };

    thisplugin.removeLabel = function(guid) {
        var previousLayer = thisplugin.labelLayers[guid];
        if(previousLayer) {
            thisplugin.numbersLayerGroup.removeLayer(previousLayer);
            delete thisplugin.labelLayers[guid];
        }
    };

    thisplugin.addLabel = function(guid, latLng, labelText) {
        if (!window.map.hasLayer(thisplugin.numbersLayerGroup)) return;
        var previousLayer = thisplugin.labelLayers[guid];

        if(previousLayer) {
            //Number of Portal may have changed, so we delete the old value.
            thisplugin.numbersLayerGroup.removeLayer(previousLayer);
            delete thisplugin.labelLayers[guid];
        }

        var label = L.marker(latLng, {
            icon: L.divIcon({
                className: 'plugin_fanfields',
                iconAnchor: [0 ,0],
                iconSize: [thisplugin.LABEL_WIDTH,thisplugin.LABEL_HEIGHT],
                html: labelText
            }),
            guid: guid
        });
        thisplugin.labelLayers[guid] = label;
        label.addTo(thisplugin.numbersLayerGroup);

    };

    thisplugin.clearAllPortalLabels = function() {
        for (var guid in thisplugin.labelLayers) {
            thisplugin.removeLabel(guid);
        }
    };

    // angle of line a,b
    // adjust for base angle c if present
    thisplugin.getAngle = function(a, b, c) {
        var angle;

        angle = Math.atan2(b.y-a.y, b.x-a.x) * thisplugin.RAD_TO_DEG;
        if (c != undefined) {
            angle = angle - c;
            if (angle < 0) {
                angle = angle + 360;
            }
        }
        return angle;
    }

    // angle between line a,b and line a,c
    thisplugin.getAngle2 = function(a, b, c) {
        var angle;
        var ax, bx, ay, cy;

        if (b === c) {
            return 0;
        }
        ax = b.x - a.x;
        ay = b.y - a.y;
        bx = c.x - a.x;
        by = c.y - a.y;

        var num = ax*bx + ay*by;
        var den = Math.sqrt(ax*ax + ay*ay) * Math.sqrt(bx*bx + by*by);

        // to do: to reduce math needed, determine if this can be
        // reduced to return(num/den)
        // for sorting purposes, conversion to degrees is not needed
        // cos(angle) decreases over 0..180, but is monotonic
        // so -1*(num/den) should work
        //angle = Math.acos(num / den) * thisplugin.RAD_TO_DEG;
        angle = Math.acos(num / den);
        return angle;
    }

    // find points in polygon 
    thisplugin.filterPolygon = function (points, polygon) {

        var result = [];
        var guid,i,j,ax,ay,bx,by,la,lb,cos,alpha,det;

        for (guid in points) {
            var asum = 0;
            for (i = 0, j = polygon.length-1; i < polygon.length; j = i, ++i) {
                ax = polygon[i].x - points[guid].x;
                ay = polygon[i].y - points[guid].y;
                bx = polygon[j].x - points[guid].x;
                by = polygon[j].y - points[guid].y;
                la = Math.sqrt(ax*ax + ay*ay);
                lb = Math.sqrt(bx*bx + by*by);
                if (Math.abs(la) < 0.1 || Math.abs(lb) < 0.1 ) { // the point is a vertex of the polygon
                    break;
		        }
                cos = (ax*bx+ay*by)/la/lb;
                if (cos < -1)
                    cos = -1;
                if (cos > 1)
                    cos = 1;
                alpha = Math.acos(cos);
                det = ax*by-ay*bx;
                if (Math.abs(det) < 0.1 && Math.abs(alpha - Math.PI) < 0.1) // the point is on a rib of the polygon
                    break;
                if (det >= 0)
                    asum += alpha;
                else
                    asum -= alpha;
            }
            if (i == polygon.length && Math.round(asum / Math.PI / 2) % 2 === 0)
                continue;

            result[guid] = points[guid];
        }
        return result;
    };


    thisplugin.n = 0;
    thisplugin.triangles = [];
    thisplugin.donelinks = [];
    thisplugin.sfLinks = [];
    thisplugin.updateLayer = function() {
        var a,b,c;
        var fanlinks = [], donelinks = [], maplinks = [];
        var triangles = [];

        var directiontest;
        var centerOutgoings = 0;
        var centerSbul = 0;
        var pa,i,pb,k,ll,p;
        var guid;
        var polygon,intersection;
        var fp_index, fp;

        thisplugin.locations = [];
        thisplugin.fanpoints = [];

        thisplugin.links = [];
        if (!window.map.hasLayer(thisplugin.linksLayerGroup) &&
            !window.map.hasLayer(thisplugin.fieldsLayerGroup) &&
            !window.map.hasLayer(thisplugin.numbersLayerGroup))
            return;


        thisplugin.linksLayerGroup.clearLayers();
        thisplugin.fieldsLayerGroup.clearLayers();
        thisplugin.numbersLayerGroup.clearLayers();
        var ctrl = [$('.leaflet-control-layers-selector + span:contains("Fanfields links")').parent(),
                    $('.leaflet-control-layers-selector + span:contains("Fanfields fields")').parent(),
                    $('.leaflet-control-layers-selector + span:contains("Fanfields numbers")').parent()];


        function drawLabel(guid, label) {
            let p = thisplugin.fanpoints[guid];
            let labelText = "";
            if (label.index === 0) {
                labelText = "Start<br>";
            }
            else {
                labelText = label.index.toString() + "<br>";
            }

            labelText += "Keys: " + label.keys.toString() + "<br>";
            labelText += "Out: " + label.links.toString();

            let latlng = map.unproject(p, thisplugin.PROJECT_ZOOM);

            thisplugin.addLabel(guid, latlng, labelText);
        }

        function drawLink(a, b, style) {
            var alatlng = map.unproject(a, thisplugin.PROJECT_ZOOM);
            var blatlng = map.unproject(b, thisplugin.PROJECT_ZOOM);

            var poly = L.polyline([alatlng, blatlng], style);
            poly.addTo(thisplugin.linksLayerGroup);

        }

        function drawField(a, b, c, style) {
            var alatlng = map.unproject(a.point, thisplugin.PROJECT_ZOOM);
            var blatlng = map.unproject(b.point, thisplugin.PROJECT_ZOOM);
            var clatlng = map.unproject(c.point, thisplugin.PROJECT_ZOOM);

            var poly = L.polygon([alatlng, blatlng, clatlng], style);
            poly.addTo(thisplugin.fieldsLayerGroup);

        }

    	// Get portal locations
        $.each(window.portals, function(guid, portal) {
            var ll = portal.getLatLng();
            var p = map.project(ll, thisplugin.PROJECT_ZOOM);

            thisplugin.locations[guid] = p;
        });

        thisplugin.intelLinks = {};
        $.each(window.links, function(guid, link) {
            var lls = link.getLatLngs();
            var line = {a: {}, b: {} };
            var a = lls[0], b  = lls[1];

            line.a = map.project(a, thisplugin.PROJECT_ZOOM);
            line.b = map.project(b, thisplugin.PROJECT_ZOOM);
            thisplugin.intelLinks[guid] = line;
        });

        // filter layers into array that only contains GeodesicPolygon
        function findFanpoints(dtLayers,locations,filter) {
            var polygon, dtLayer, result = [];
            var i, filtered;
            var fanLayer;
            for( dtLayer in dtLayers) {
                fanLayer = dtLayers[dtLayer];
                if (!(fanLayer instanceof L.GeodesicPolygon)) {
                    continue;
                 }
                ll = fanLayer.getLatLngs();

                polygon = [];
                for ( k = 0; k < ll.length; ++k) {
                    p = map.project(ll[k], thisplugin.PROJECT_ZOOM);
                    polygon.push(p);
                }
                filtered = filter(locations, polygon);
                for (i in filtered) {
                    result[i] = filtered[i];
                }
            }
            return result;
        }

        this.fanpoints = findFanpoints(plugin.drawTools.drawnItems._layers,
                                       this.locations,
                                       this.filterPolygon);

        var npoints = Object.keys(this.fanpoints).length;
        // no fields if npoints < 3
        if (npoints < 3) {
            //console.log('< 3 points found');
	        return;
        }
        
        // Find convex hull from fanpoints list of points
        // Returns array of {guid: , point:{x:, y:}}
        function convexHull(points) {

            function cross(a, b, o) {
                return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
            }
            // convert to array of [guid, point]
            var pa = Object.entries(points).map(p => [p[0], p[1]]);
            // sort by x then y if x the same
            pa.sort(function(a, b) {
                return a[1].x == b[1].x ? a[1].y - b[1].y : a[1].x - b[1].x;
            });

            var lower = [];
            var i;
            for (i = 0; i < pa.length; i++) {
                while (lower.length >= 2 && cross(lower[lower.length - 2].point, lower[lower.length - 1].point, pa[i][1]) <= 0) {
                    lower.pop();
                }
                lower.push({guid:pa[i][0], point:pa[i][1]});
            }

            var upper = [];
            for (i = pa.length - 1; i >= 0; i--) {
                while (upper.length >= 2 && cross(upper[upper.length - 2].point, upper[upper.length - 1].point, pa[i][1]) <= 0) {
                    upper.pop();
                }
                upper.push({guid:pa[i][0], point:pa[i][1]});
            }

            upper.pop();
            lower.pop();

            return lower.concat(upper);
        };

        thisplugin.hullPoints = convexHull(this.fanpoints);
	    console.log('Found perimeter points :', thisplugin.hullPoints.length);
        //console.log('hull points = ', thisplugin.hullPoints);

        // Must have >= 3 hull points to proceed
        if (thisplugin.hullPoints.length < 3) 
            return;

        // Use currently selected index in outer hull as starting point
        // *** Move this to start set/update handler
        {
            //console.log('update layer start=', thisplugin.start);
            var index;
            if (thisplugin.start.index == undefined) {
                index = 0;
            } else {
                index = thisplugin.start.index;
            }
            
            if (index >= thisplugin.hullPoints.length) {
                index = 0;
            }
            //console.log("next start index = ", index);

            var guid = thisplugin.hullPoints[index].guid;
            var point = thisplugin.fanpoints[guid];

            thisplugin.start = {guid : guid, point : point, index : index};
            //console.log('next start =', thisplugin.start);
        }
        
        // triangulate outer hull
        // begin at start, zigzag across hullPoints
        // *** move this to triangulate function
        if (thisplugin.multiField) {
            thisplugin.numSubFields = thisplugin.hullPoints.length - 2;
        }
        else {
            thisplugin.numSubFields = 1;
        }
        var subfield_range = [...Array(thisplugin.numSubFields).keys()];

        // truncate arrays to sub field count, required when new portal data changes the outer hull
        thisplugin.sortedFanpoints.length = thisplugin.numSubFields;
        thisplugin.sfLinks.length = thisplugin.numSubFields;

        // arrays for each subfield
        for (i of subfield_range) {
            thisplugin.sortedFanpoints[i] = [];
            thisplugin.sfLinks[i] = [];
        }

        var sfIndices = [];

        var sfi = thisplugin.start.index;
        var pmax = thisplugin.hullPoints.length;
        var tri_dir = -1;

        // calc last perimeter index
        // dir selects between ccw(-1) and cw(1) advance
        function sflast(p, dir, max) {  
            var n = p + dir * 1;
            n = (max + n % max) % max;
            return n;
        }

        // sfIndices : list of indices in hullPoints defining subfield boundary
        // each list of 3 indices defines 1 subfield
        // sfBoundary : list of 3 points which define subfield outer links
        var sfBoundary = [];
        for (sf of subfield_range) {
            var p = thisplugin.hullPoints;
            var indices = [];
            if (sf === 0) {
                indices = [sfi, (sfi+1) % pmax, (sfi+2) % pmax];
            }
            else {
                indices = [sfIndices[sf-1][2], sfIndices[sf-1][0], sflast(sfIndices[sf-1][0], tri_dir, pmax)];
                tri_dir *= -1; 
            }
            sfIndices.push(indices);
            sfBoundary.push([p[indices[0]], p[indices[1]], p[indices[2]]]);
        }

        // filter selected portals into sub fields
        var sfFanpoints = [];
        if (thisplugin.multiField) {
            for (poly of sfBoundary) {
                var poly_points = poly.map(function(p) {return p.point});
                var sf_filtered = thisplugin.filterPolygon(thisplugin.fanpoints, poly_points);
                sfFanpoints.push(sf_filtered);
            }
        } else {
             sfFanpoints.push(thisplugin.fanpoints);
        }
        //console.log('sfFanpoints:', sfFanpoints);

        // *** this is for multifield debug; could be merged into regular draw link
        // outline subfields in thicker blue lines
        /*
        for (sf of sfBoundary) {
            var points = sf.map(function(p) {return p.point});
            for (i=0; i < 3; i++) {
                drawLink(points[i], points[(i+1)%3], {
                    color: '#0000FF',
                    opacity: 1,
                    weight: 4,
                    clickable: false,
                    smoothFactor: 10,
                    //dashArray: [10, 5, 5, 5, 5, 5, 5, 5, "100%" ],
                });  
            }
        }
        */

        // each sub field adds an array of points to sortedFanpoints
        for (mfIdx = 0; mfIdx < thisplugin.numSubFields; mfIdx++) {    

            // base line of each subfield is first 2 boundary points
            let base0 = sfBoundary[mfIdx][0].point;
            let base1 = sfBoundary[mfIdx][1].point;

            // create sortedFanpoints from all selected portals
            thisplugin.sortedFanpoints[mfIdx] = [];
            thisplugin.sfLinks[mfIdx] = [];
            for (guid in sfFanpoints[mfIdx]) {
                fp = sfFanpoints[mfIdx][guid];
                let fp_angle;
                let is_start;
                let is_outer;

                is_start = guid == sfBoundary[mfIdx][0].guid;
                is_outer = (is_start || (guid == sfBoundary[mfIdx][1].guid) || (guid == sfBoundary[mfIdx][2].guid));

                // force subfield anchor to start of sorted portals by setting its angle to -1
                // (inner angles of triangles are 0..180 degrees)
                if (is_start) {
                    fp_angle = -1;
                } else {
                    fp_angle = thisplugin.getAngle2(base0, base1, fp);
                }
                
                this.sortedFanpoints[mfIdx].push({point: fp,
                                        angle: fp_angle,
                                        guid: guid,
                                        incoming: [],
                                        outgoing: [],
                                        //is_start: is_start,
                                        is_outer: is_outer
                                        });
            }

            this.sortedFanpoints[mfIdx].sort(function(a, b){
                return a.angle - b.angle;
            });

            if (!thisplugin.is_clockwise) {
                // reverse all but the first element
                this.sortedFanpoints[mfIdx] = this.sortedFanpoints[mfIdx].concat(this.sortedFanpoints[mfIdx].splice(1,this.sortedFanpoints[mfIdx].length-1).reverse());
            }

            // points for all subfields found and sorted by angle

            // find fanfield links in each subfield
            donelinks = [];
            var possibleline;
            var testlink;
            for(pa = 0; pa < this.sortedFanpoints[mfIdx].length; pa++){

                //console.log('pa#, guid', pa, this.sortedFanpoints[mfIdx][pa].guid);
                //console.log('donelinks len:', donelinks.length);
                for(pb = 0 ; pb < pa; pb++) {
                    //console.log('link test a,b:', pa, pb);
                    //console.log('pb#, guid', pb, this.sortedFanpoints[mfIdx][pb].guid);

                    let is_outer = this.sortedFanpoints[mfIdx][pa].is_outer && this.sortedFanpoints[mfIdx][pb].is_outer;
                    a = {point: this.sortedFanpoints[mfIdx][pa].point, guid: this.sortedFanpoints[mfIdx][pa].guid};
                    b = {point: this.sortedFanpoints[mfIdx][pb].point, guid: this.sortedFanpoints[mfIdx][pb].guid};

                    // *** to do: merge possibleline into testlink
                    /*
                    possibleline = {a: a,
                                    b: b,
                                    angle: 0,
                                    isJetLink: false,
                                    isFanLink: (pb===0),
                                    counts: true
                                    };
                    */
                    testlink = {a: a, b: b, counts: true, is_outer: is_outer};

                    intersection = 0;
                    maplinks = [];
                    /*
                    if (thisplugin.respectCurrentLinks) {
                        $.each(thisplugin.intelLinks, function(guid,link){
                            maplinks.push(link);
                        });
                        for (i in maplinks) {
                            if (this.intersects(possibleline,maplinks[i]) ) {
                                intersection++;
                                break;
                            }
                        }
                        if (this.linkExists(maplinks, possibleline)) {
                            possibleline.counts = false;
                        }
                    }
                    */

                    // check if this link is a shared link from the previous sub field
                    if (mfIdx > 0 && testlink.is_outer) {
                        for (l of thisplugin.sfLinks[mfIdx-1]) {
                            if (l.is_outer) {
                                if (((l.a.guid == testlink.a.guid) && (l.b.guid == testlink.b.guid)) ||
                                    ((l.a.guid == testlink.b.guid) && (l.b.guid == testlink.a.guid))) {
                                        intersection++;
                                        break;
                                    }
                            }
                        }
                    }

                    // check if testlink crosses any previous link in current sub field
                    for (i in thisplugin.sfLinks[mfIdx]) {
                            if (this.intersects(testlink,thisplugin.sfLinks[mfIdx][i])) {
                            intersection++;
                            break;
                        }
                    }

                    // update link data for a valid link
                    if (intersection === 0) {
                        var thirds = [];
                        /*
                        if (thisplugin.respectCurrentLinks) {
                            if (possibleline.counts) {
                                thirds = this.getThirds(donelinks.concat(maplinks),possibleline.a, possibleline.b);
                            }
                        } else {
                            thirds = this.getThirds(donelinks,possibleline.a, possibleline.b);
                        }
                        */
                        //console.log('new link: ',testlink);
                        // find triangles formed by test link
                        thirds = this.getThirds(thisplugin.sfLinks[mfIdx],testlink);

                        if (thirds.length > 0) 
                            console.log('found triangles: ', thirds.length);

                        //console.log('add link:', mfIdx, testlink);
                        thisplugin.sfLinks[mfIdx].push(testlink);

                        if (testlink.counts) {
                            this.sortedFanpoints[mfIdx][pa].outgoing.push(this.sortedFanpoints[mfIdx][pb]);
                            this.sortedFanpoints[mfIdx][pb].incoming.push(this.sortedFanpoints[mfIdx][pa]);
                        }

                        for (var t in thirds) {
                            //triangles.push({a:thirds[t], b:possibleline.a, c:possibleline.b});
                            
                            triangles.push({a:thirds[t], b:testlink.a, c:testlink.b});
                        }
                        console.log('triangles :', triangles);
                    }
                }
            }
        // end mfIdx loop
        }

        console.log('sortedFanpoints:', thisplugin.sortedFanpoints);
        console.log('sfLinks:', thisplugin.sfLinks);

        thisplugin.triangles = triangles;
        
        // *** Should this be total or for each subfield?
        /*
        if (this.sortedFanpoints[mfIdx].length > 3) {
            thisplugin.triangles = triangles;
            thisplugin.donelinks = donelinks;
            thisplugin.n = n;
            var MessageStr =
                console.log("== Fan Fields == " +
                            "\nFanPortals: " + (n-1) +
                            "\nCenterKeys:" + thisplugin.centerKeys +
                            "\nTotal links / keys:    " + donelinks.length.toString() +
                            "\nFields:                " + triangles.length.toString() +
                            "\nBuild AP:              " + (donelinks.length*313 + triangles.length*1250).toString() +
                            "\nDestroy AP:            " + (this.sortedFanpoints[0].length*187 + triangles.length*750).toString());
        }
        */

        // remove any not wanted
        thisplugin.clearAllPortalLabels();

        // and add those we do

        // label info
        thisplugin.labels = [];
        // Count keys,links and create unique index for each portal for all sub fields
        // hull points are part of multiple fields but need 1 index for labels
        let label_index;
        thisplugin.sortedFanpoints.forEach(function(sf, sfnum){
            sf.forEach(function(p, n) {
                if (thisplugin.labels[p.guid] == undefined) {
                    if (n === 0 && sfnum === 0) {
                        label_index = 0;
                    }
                    else {
                        label_index += 1;
                    }
                    thisplugin.labels[p.guid] = {keys: 0, links: 0, index: label_index};
                }
                thisplugin.labels[p.guid].keys += p.incoming.length;
                thisplugin.labels[p.guid].links += p.outgoing.length;
            });
        });

        for (p of Object.keys(thisplugin.labels)) { 
            drawLabel(p, thisplugin.labels[p]);
        }

        thisplugin.sfLinks.forEach(function(sf) {
            sf.forEach(function(l) {
                drawLink(l.a.point, l.b.point, {
                color: '#FF0000',
                opacity: 1,
                weight: 1.5,
                clickable: false,
                smoothFactor: 10,
                dashArray: [10, 5, 5, 5, 5, 5, 5, 5, "100%" ],
               });
               
           });
       });

       
        $.each(triangles, function(idx, triangle) {
            drawField(triangle.a, triangle.b, triangle.c, {
                stroke: false,
                fill: true,
                fillColor: '#FF0000',
                fillOpacity: 0.1,
                clickable: false,
            });
        });
        
    };

    // as calculating portal marker visibility can take some time when there's lots of portals shown, we'll do it on
    // a short timer. this way it doesn't get repeated so much
    thisplugin.delayedUpdateLayer = function(wait) {
        if (thisplugin.timer === undefined) {
            thisplugin.timer = setTimeout ( function() {

                thisplugin.timer = undefined;
                if (!thisplugin.is_locked) 
		            thisplugin.updateLayer();
            }, wait*350);
        }
    };

    thisplugin.setup = function() {
        var button12 = '<a class="plugin_fanfields_btn" onclick="window.plugin.fanfields.nextstartPoint();">Move Start</a> ';
        var button13 = '<a class="plugin_fanfields_btn" id="plugin_fanfields_mfbtn" onclick="window.plugin.fanfields.toggleMultiField();">Single Anchor</a> ';

        var button7 = '<a class="plugin_fanfields_btn" id="plugin_fanfields_lockbtn" onclick="window.plugin.fanfields.lock();">Unlocked</a> ';

        //var button4 = '<a class="plugin_fanfields_btn" onclick="window.plugin.fanfields.exportText();">Show&nbsp;as&nbsp;list</a> ';
        var button4 = '<a class="plugin_fanfields_btn" onclick="window.plugin.fanfields.exportText();">Show&nbsp;List</a> ';
        var button3 = '<a class="plugin_fanfields_btn" onclick="window.plugin.fanfields.saveBookmarks();">Write&nbsp;Bookmarks</a> ';

        //var button5 = '<a class="plugin_fanfields_btn" id="plugin_fanfields_resetbtn" onclick="window.plugin.fanfields.reset();">Reset</a> ';
        //var button6 = '<a class="plugin_fanfields_btn" id="plugin_fanfields_clckwsbtn" onclick="window.plugin.fanfields.toggleclockwise();">Clockwise:(&#8635;)</a> ';

        //var button8 = '<a class="plugin_fanfields_btn" id="plugin_fanfields_stardirbtn" onclick="window.plugin.fanfields.toggleStarDirection();">inbounding</a> ';
        //var button9 = '<a class="plugin_fanfields_btn" id="plugin_fanfields_respectbtn" onclick="window.plugin.fanfields.toggleRespectCurrentLinks();">Respect&nbsp;Intel:&nbsp;OFF</a> ';
        var button10 = '<a class="plugin_fanfields_btn" id="plugin_fanfields_statsbtn" onclick="window.plugin.fanfields.showStatistics();">Stats</a> ';
        var button11 = '<a class="plugin_fanfields_btn" id="plugin_fanfields_exportbtn" onclick="window.plugin.fanfields.exportDrawtools();">Write&nbsp;DrawTools</a> ';
        var button1 = '<a class="plugin_fanfields_btn" id="plugin_fanfields_helpbtn" onclick="window.plugin.fanfields.help();" >Help</a> ';
        var fanfields_buttons =
            button12 + 
            button13 +
            button3 + button11 +
            button4 +
            //  button5 +
            //button6 +
            button7 +
            //button8 +
            //button9 +
            button10 +
            button1
        ;
        $('#toolbox').append('<fieldset '+
                             'id="plugin_fanfields_toolbox"'+
                             'style="' +
                             'margin: 5px;' +
                             'padding: 3px;' +
                             'border: 1px solid #ffce00;' +
                             'box-shadow: 3px 3px 5px black;' +
                             'color: #ffce00;' +
                             '"><legend >Fan Fields</legend></fieldset>');

        if (!window.plugin.drawTools || !window.plugin.bookmarks) {

            // *** remove static link to plugin location
            dialog({
                //html: '<b>Fan Fields</b><p>Fan Fields requires IITC drawtools and bookmarks plugins</p><a href="https://iitc.me/desktop/">Download here</a>',
                html: '<b>Fan Fields</b><p>Fan Fields requires IITC drawtools and bookmarks plugins</p>',
                id: 'plugin_fanfields_alert_dependencies',
                title: 'Fan Fields - Missing dependency'
            });
            $('#plugin_fanfields_toolbox').empty();
            $('#plugin_fanfields_toolbox').append("<i>Fan Fields requires IITC drawtools and bookmarks plugins.</i>");

            return;
        }

        $('#plugin_fanfields_toolbox').append(fanfields_buttons);
        thisplugin.setupCSS();
        thisplugin.linksLayerGroup = new L.LayerGroup();
        thisplugin.fieldsLayerGroup = new L.LayerGroup();
        thisplugin.numbersLayerGroup = new L.LayerGroup();

        window.pluginCreateHook('pluginDrawTools');

        window.addHook('pluginDrawTools',function(e) {
            thisplugin.delayedUpdateLayer(0.5);
        });
        window.addHook('mapDataRefreshEnd', function() {
            thisplugin.delayedUpdateLayer(0.5);
        });
        window.addHook('requestFinished', function() {
            setTimeout(function(){thisplugin.delayedUpdateLayer(3.0);},1);
        });

        window.map.on('moveend', function() {
            thisplugin.delayedUpdateLayer(0.5);
        });
        window.map.on('overlayadd overlayremove', function() {
            console.log('overlayadd overlayremove');
            setTimeout(function(){
                thisplugin.delayedUpdateLayer(1.0);
            },1);
        });

        window.addLayerGroup('Fanfields links', thisplugin.linksLayerGroup, false);
        window.addLayerGroup('Fanfields fields', thisplugin.fieldsLayerGroup, false);
        window.addLayerGroup('Fanfields numbers', thisplugin.numbersLayerGroup, false);

    };


    var setup = thisplugin.setup;

    // PLUGIN END //////////////////////////////////////////////////////////


    setup.info = plugin_info; //add the script info data to the function as a property
    if(!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    // if IITC has already booted, immediately run the 'setup' function
    if(window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end
// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);




// EOF
