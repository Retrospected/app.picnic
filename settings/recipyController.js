angular.module('picnicApp', ['smart-table'])
    .controller('RecipySettingsController', function($scope) {
        var rm = this;
        rm.errorMessage = '';
        rm.showExportToggle = false;
        rm.showImportToggle = false;
        rm.importJson = '';
        rm.selected = {};
        rm.homey;

        rm.setHomey = function(homey, scope) {
            rm.homey = homey;
            rm.homey.get('recipies', function(err, newRecipies) {
                if (!newRecipies) {
                    newRecipies = [];
                }
                scope.$apply(function() {
                    rm.recipies = newRecipies;
                });
            });
            rm.homey.on('setting_changed', function(name) {
                rm.homey.get('recipies', function(err, recipies) {
                    if (!recipies) {
                        recipies = [];
                    }
                    $scope.$apply(function() {
                        rm.recipies = recipies;
                    });
                });
            });
        }
        rm.addIngredient = function() {
          var e = document.getElementById("selectedRecipy");
          var selectedRecipy = e.options[e.selectedIndex].text;
          rm.recipies.forEach(function(item, index, arr) {
            if (item.name === selectedRecipy) {

              rm.recipies[index]["ingredients"].push(rm.newIngredient.name);
            }
          })
          rm.homey.set('recipies', angular.copy(rm.recipies), function( err, result ) {
            if( err ) {
              rm.errorMessage = err;
            }
            else {
              rm.errorMessage = '';
              document.getElementById("ingredientName").value = '';
            }
          });
        }

        rm.addRecipy = function() {
            if (rm.recipies && rm.newRecipy.name in rm.recipies) {
                rm.errorMessage = "Recipy does already exist in database.";
                return;
            }
            rm.recipies.push({
              name: rm.newRecipy.name,
              ingredients: []
            })

            rm.homey.set('recipies', angular.copy(rm.recipies), function( err, result ) {
              if( err ) {
                rm.errorMessage = err;
              }
              else {
                rm.errorMessage = '';
                var e = document.getElementById("selectedRecipy");
                e.options[e.selectedIndex].text = rm.newRecipy.name;
                document.getElementById("recipyName").value = '';
              }
            });
            rm.Recipy = {};
        };
        rm.deleteAll = function() {
            rm.recipies = [];
            rm.homey.set('recipies', rm.recipies);

        }
        rm.removeRecipy = function(row) {
          var index = rm.recipies.indexOf(row);
          var toDeleteRecipy = rm.recipies[index];
          toDeleteRecipy.remove = true;
          rm.recipies.splice(index, 1);
          rm.homey.set('recipies', angular.copy(rm.recipies));
        };

        rm.showExport = function() {
            rm.showExportToggle = !rm.showExportToggle;
        };
        rm.showImport = function() {
            rm.showImportToggle = !rm.showImportToggle;
        };

        rm.import = function() {
            var newRecipies = angular.fromJson(rm.importJson);
            rm.deleteAll();
            rm.homey.set('recipies', newRecipies);
            rm.recipies = newRecipies;
        };

        rm.editRecipy = function(recipy) {
            rm.selected = angular.copy(recipy);
        };

        rm.saveRecipy = function(row) {
            var index = rm.recipies.indexOf(row);
            var indexDisplay = $scope.displayedCollection.indexOf(row);
            rm.recipies[index] = angular.copy(rm.selected);
            $scope.displayedCollection[indexDisplay] = angular.copy(rm.selected);
            storeRecipy(angular.copy(rm.recipies), rm.selected);
            rm.reset();
        };


        rm.reset = function() {
            rm.selected = {};
        };

        rm.selectUpdate = function(type) {
            if (type === 'boolean') {
                rm.newRecipy.value = false;
                return;
            }
            if (type === 'number') {
                rm.newRecipy.value = 0;
                return;
            }
            rm.newRecipy.value = '';
            return;
        }

        rm.getTemplate = function(recipy) {
            if (recipy.name === rm.selected.name) return 'edit';
            else return 'display';
        };
    });
