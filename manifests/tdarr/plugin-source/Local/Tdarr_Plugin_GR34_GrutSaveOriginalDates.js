//const path = require('path/posix');

/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
function details() {
  return {
    id: 'Tdarr_Plugin_GR34_GrutSaveOriginalDates',
    Stage: 'Pre-processing',
    Name: 'Grut-Save original dates',
    Type: 'AudDateDio',
    Operation: 'Save',
    Description: 'This plugin save dates (atime/mtime) of the original media to a JSON file. Should be used as FIRST plugin in the stack. To restore the original date after transcoding, use Tdarr_Plugin_GR34_GrutRestoreOriginalDates.\n\n',
    Version: '0.1',
    Link: '',
    Tags: 'pre-processing,save,original,date',
    Inputs: [
      {
        name: 'debug',
        tooltip: `print some debug output in node log (ie docker logs...).
              \\nOptional.
              \\nExample:\\n
              true
              \\nExample:\\n
              false
              \\nDefault:\\n
              false
              `,
      },
    ],
  };
}

function print_debug(debug, message) {
  prefix=new Date().toISOString()+ " - " + "Tdarr_Plugin_GR34_GrutSaveOriginalDates - "
  if(debug)
    console.log(prefix+message)
}

function plugin(file, librarySettings, inputs) {
  const response = {
    processFile: false,
    container: `.${file.container}`,
    handBrakeMode: false,
    FFmpegMode: false,
    reQueueAfter: false,
    infoLog: '',
  };

  fs = require('fs');
  path = require('path');

  let debug=false
  if (inputs && inputs.debug && inputs.debug.toLowerCase() === 'true')
    debug=true 

  //Parsethe file property to get the path and the filenamae
  parsed_file=path.parse(file.file);
  
  // If the file being processed is a cache file, don't save the dates.
  // We do it only for the actual file being transcoded)
  if(parsed_file.name.includes("-TdarrCacheFile-")){
    print_debug(debug,'######This is a temp file. Don\'t save dates '+file.file)
  }
  else
  {
    print_debug(debug,'###### Saving original dates for '+file.file)
    print_debug(debug,"Original atime = "+file.statSync.atime)
    print_debug(debug,"Original mtime = "+file.statSync.mtime)
    
    
    date_file=`${parsed_file.dir}${path.posix.sep}${parsed_file.name}.dates`

    print_debug(debug,"Save dates in "+date_file)
    
    try {

      // convert JSON object to a string
      const data = JSON.stringify(file.statSync, null, 4);

      // write file to disk
      fs.writeFileSync(date_file, data, 'utf8');

      print_debug(debug,`File is written successfully!`);

    } catch (err) {
      print_debug(debug,`Error writing file: ${err}`);
    }
    print_debug(debug,'###### End Processing '+file.file)
    
  }
  print_debug(debug,'')
  print_debug(debug,'')
  response.processFile = false;
  return response;
}
module.exports.details = details;
module.exports.plugin = plugin;
